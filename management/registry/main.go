package main

import (
	"context"
	"log"
	"net/http"
	"os/signal"
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

func main() {
	cfg := config.Load()

	db := store.Init(cfg)
	store.RunMigrations(db)
	store.BootstrapSuperadmin(db, cfg.AdminUser, cfg.AdminPass)
	store.BootstrapRBAC(db)

	auth := &middleware.Auth{Config: cfg, DB: db}
	ml := &mailer.Mailer{Config: cfg, DB: db}
	h := &handler.Handler{DB: db, Config: cfg, Auth: auth, Mailer: ml}

	go h.StartProbeLoop()
	go h.StartLifecycleLoop()
	go h.StartTrafficLoop()
	go ml.StartExpiryNotifier()

	mux := h.RegisterRoutes()

	middleware.RefreshNodeGauge(db)

	wrapped := middleware.WithMetrics(middleware.WithCORS(mux, cfg))

	addr := ":" + cfg.Port
	srv := &http.Server{Addr: addr, Handler: wrapped}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

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
	log.Println("stopped")
}
