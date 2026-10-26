package handler

import (
	"net/http"
	"time"

	"gorm.io/gorm"

	"hive/registry/internal/model"
)

type renewalSubscription struct {
	ID        uint
	ExpiresAt time.Time
	Status    string
}

// The caller holds the customer lock. Renew the most useful existing subscription
// for this plan, without rotating identity, resetting traffic or losing bindings.
func fulfillSubscriptionOrder(tx *gorm.DB, order *model.Order, plan model.Plan, now time.Time) error {
	var sub renewalSubscription
	if err := tx.Raw(`SELECT id, expires_at, status FROM customer_subscriptions
        WHERE customer_id = ? AND plan_id = ?
        ORDER BY (status = 'active' AND expires_at > ?) DESC, expires_at DESC, id DESC
        LIMIT 1 FOR UPDATE`, order.CustomerID, order.PlanID, now).Scan(&sub).Error; err != nil {
		return err
	}
	previousExpiry := sub.ExpiresAt
	if sub.ID == 0 {
		previousExpiry = now
		token, err := generateToken()
		if err != nil {
			return err
		}
		uuid, err := generateUUID()
		if err != nil {
			return err
		}
		if err := tx.Exec(`INSERT INTO customer_subscriptions (customer_id, plan_id, token, xray_uuid,
            traffic_used, traffic_limit, device_limit, started_at, expires_at, status, created_at, updated_at)
            VALUES (?,?,?,?,0,?,?,?,?,'active',?,?)`, order.CustomerID, order.PlanID, token, uuid,
			plan.TrafficLimit, plan.DeviceLimit, now, now.AddDate(0, 0, plan.DurationDays), now, now).Error; err != nil {
			return err
		}
		if err := tx.Raw("SELECT LAST_INSERT_ID()").Scan(&sub.ID).Error; err != nil {
			return err
		}
	} else {
		base := previousExpiry
		if base.Before(now) {
			base = now
		}
		// A purchase does not override an administrator's suspension. Quota checks
		// also remain effective: renewal buys time, not another traffic allowance.
		status := "active"
		if sub.Status == "suspended" {
			status = "suspended"
		}
		if err := tx.Exec("UPDATE customer_subscriptions SET expires_at = ?, status = ?, updated_at = ? WHERE id = ?",
			base.AddDate(0, 0, plan.DurationDays), status, now, sub.ID).Error; err != nil {
			return err
		}
	}
	return tx.Exec(`UPDATE order_fulfillments SET subscription_id = ?, duration_days = ?, granted_at = ?,
        previous_expires_at = ? WHERE order_id = ?`, sub.ID, plan.DurationDays, now, previousExpiry, order.ID).Error
}

type subscriptionTimeGrant struct {
	OrderID           uint
	DurationDays      int
	GrantedAt         time.Time
	PreviousExpiresAt time.Time
	Status            string
}

// Replay paid time grants in fulfillment order. Keeping the payment timestamps
// means refunding an old term cannot remove a later purchase after an expired gap.
func replaySubscriptionExpiry(grants []subscriptionTimeGrant, refundedOrder uint) time.Time {
	expiry := grants[0].PreviousExpiresAt
	for _, grant := range grants {
		if grant.OrderID == refundedOrder || grant.Status != "paid" {
			continue
		}
		if expiry.Before(grant.GrantedAt) {
			expiry = grant.GrantedAt
		}
		expiry = expiry.AddDate(0, 0, grant.DurationDays)
	}
	return expiry
}

func refundSubscriptionOrder(tx *gorm.DB, orderID, subscriptionID uint, now time.Time) error {
	var sub renewalSubscription
	if err := tx.Raw("SELECT id, expires_at, status FROM customer_subscriptions WHERE id = ? FOR UPDATE", subscriptionID).Scan(&sub).Error; err != nil {
		return err
	}
	if sub.ID == 0 {
		return nil
	} // already deleted by an administrator
	var grants []subscriptionTimeGrant
	if err := tx.Raw(`SELECT f.order_id, f.duration_days, f.granted_at, f.previous_expires_at, o.status
        FROM order_fulfillments f JOIN orders o ON o.id = f.order_id
        WHERE f.subscription_id = ? AND f.duration_days > 0 ORDER BY f.sequence_id`, subscriptionID).Scan(&grants).Error; err != nil {
		return err
	}
	if len(grants) == 0 {
		// Pre-migration fulfillment represented a single, independent subscription.
		return tx.Exec("UPDATE customer_subscriptions SET status = 'expired', updated_at = ? WHERE id = ?", now, sub.ID).Error
	}
	found := false
	for _, g := range grants {
		if g.OrderID == orderID {
			found = true
		}
	}
	if !found || !replaySubscriptionExpiry(grants, 0).Equal(sub.ExpiresAt) {
		// Do not guess the duration of a legacy order or overwrite a manual expiry
		// adjustment. The complete refund transaction, including money, rolls back.
		return &orderRequestError{http.StatusConflict, "subscription expiry requires reconciliation before refund"}
	}
	expiry := replaySubscriptionExpiry(grants, orderID)
	status := sub.Status
	if status != "suspended" {
		status = "active"
		if !expiry.After(now) {
			status = "expired"
		}
	}
	return tx.Exec("UPDATE customer_subscriptions SET expires_at = ?, status = ?, updated_at = ? WHERE id = ?", expiry, status, now, sub.ID).Error
}
