package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"hive/registry/internal/config"
	"hive/registry/internal/handler"
	"hive/registry/internal/mailer"
	"hive/registry/internal/middleware"
	"hive/registry/internal/store"
)

// @title Hive Node Registry API
// @version 0.1.0
// @description Hive management plane API for nodes and subscriptions.
// @BasePath /
// @schemes https http

// @securityDefinitions.apikey BearerAuth
// @in header
// @name Authorization
// @description "Authorization: Bearer <API_SECRET>"

// @securityDefinitions.apikey AdminSessionCookie
// @in cookie
// @name hive_admin_session
// @description "HttpOnly session cookie for admin UI"

// @securityDefinitions.apikey CustomerSessionCookie
// @in cookie
// @name hive_customer_session
// @description "HttpOnly session cookie for customer portal"

func main() {
	cfg := config.Load()

	// Validate critical security secrets in production.
	// Missing secrets would silently disable auth, so we fail fast.
	if os.Getenv("HIVE_ENV") != "dev" {
		var missing []string
		if cfg.APISecret == "" {
			missing = append(missing, "API_SECRET")
		}
		if cfg.AdminSessionSecret == "" {
			missing = append(missing, "ADMIN_SESSION_SECRET")
		}
		if len(missing) > 0 {
			log.Fatalf("FATAL: required security env vars not set: %v — set them or use HIVE_ENV=dev to skip this check", missing)
		}
	}

	db := store.Init(cfg)
	store.RunMigrations(db)
	store.BootstrapSuperadmin(db, cfg.AdminUser, cfg.AdminPass)
	store.BootstrapRBAC(db)

	auth := &middleware.Auth{Config: cfg, DB: db}
	ml := &mailer.Mailer{Config: cfg, DB: db}
	h := &handler.Handler{DB: db, Config: cfg, Auth: auth, Mailer: ml}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	var wg sync.WaitGroup
	wg.Add(4)
	go func() { defer wg.Done(); h.StartProbeLoop(ctx) }()
	go func() { defer wg.Done(); h.StartLifecycleLoop(ctx) }()
	go func() { defer wg.Done(); h.StartTrafficLoop(ctx) }()
	go func() { defer wg.Done(); ml.StartExpiryNotifier(ctx) }()

	mux := h.RegisterRoutes()

	middleware.RefreshNodeGauge(db)

	wrapped := middleware.WithMetrics(middleware.WithCORS(mux, cfg))

	addr := ":" + cfg.Port
	srv := &http.Server{Addr: addr, Handler: wrapped}

	go func() {
		log.Printf("listening on %s", addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("shutting down...")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("shutdown error: %v", err)
	}

	wg.Wait()
	log.Println("stopped")
}
