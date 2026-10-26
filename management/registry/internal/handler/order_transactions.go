package handler

import (
	"errors"
	"fmt"
	"log"
	"net/http"
	"time"

	"gorm.io/gorm"

	"hive/registry/internal/model"
)

type orderRequestError struct {
	status  int
	message string
}

func (e *orderRequestError) Error() string { return e.message }
func orderInvalid(message string) error    { return &orderRequestError{http.StatusBadRequest, message} }
func (h *Handler) orderError(w http.ResponseWriter, err error) {
	var invalid *orderRequestError
	if errors.As(err, &invalid) {
		h.jsonErr(w, invalid.status, invalid.message)
		return
	}
	log.Printf("order transaction: %v", err)
	h.jsonErr(w, http.StatusInternalServerError, "order transaction failed")
}

func (h *Handler) createCustomerOrder(cid uint, req PortalCreateOrderRequest) (model.Order, error) {
	var o model.Order
	err := h.DB.Transaction(func(tx *gorm.DB) error {
		var c model.Customer
		if err := tx.Raw("SELECT * FROM customers WHERE id = ? FOR UPDATE", cid).Scan(&c).Error; err != nil {
			return err
		}
		if c.ID == 0 || (c.Status != "active" && c.Status != "suspended") {
			return orderInvalid("account disabled")
		}
		var plan model.Plan
		if err := tx.Raw("SELECT * FROM plans WHERE id = ? AND enabled = 1", req.PlanID).Scan(&plan).Error; err != nil {
			return err
		}
		if plan.ID == 0 || plan.Price < 0 {
			return orderInvalid("plan not found or disabled")
		}
		o = model.Order{OrderNo: generateOrderNo(), CustomerID: cid, PlanID: plan.ID, Amount: plan.Price, OriginalAmount: plan.Price, Status: "pending"}
		now := time.Now().UTC()
		if req.PromoCode != "" {
			var p model.PromoCode
			if err := tx.Raw(`SELECT * FROM promo_codes WHERE code = ? AND enabled = 1
                AND valid_from <= ? AND valid_to >= ? AND (max_uses = 0 OR used_count < max_uses) FOR UPDATE`, req.PromoCode, now, now).Scan(&p).Error; err != nil {
				return err
			}
			if p.ID == 0 {
				return orderInvalid("invalid or expired promo code")
			}
			if p.DiscountPct > 0 {
				o.Amount = o.Amount * (100 - p.DiscountPct) / 100
			}
			o.Amount = max(0, o.Amount-p.DiscountAmt)
			o.PromoCodeID = &p.ID
			if err := tx.Exec("UPDATE promo_codes SET used_count = used_count + 1 WHERE id = ?", p.ID).Error; err != nil {
				return err
			}
		}
		if req.UseBalance && o.Amount > 0 {
			o.BalanceDeducted = min(max(c.Balance, 0), o.Amount)
			o.Amount -= o.BalanceDeducted
			if err := tx.Exec("UPDATE customers SET balance = balance - ? WHERE id = ?", o.BalanceDeducted, cid).Error; err != nil {
				return err
			}
		}
		if err := tx.Exec(`INSERT INTO orders (order_no, customer_id, plan_id, amount, original_amount,
            promo_code_id, balance_deducted, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,'pending',?,?)`,
			o.OrderNo, cid, o.PlanID, o.Amount, o.OriginalAmount, o.PromoCodeID, o.BalanceDeducted, now, now).Error; err != nil {
			return err
		}
		if err := tx.Raw("SELECT LAST_INSERT_ID()").Scan(&o.ID).Error; err != nil {
			return err
		}
		if o.Amount == 0 {
			return h.transitionOrder(tx, &o, "paid")
		}
		return nil
	})
	return o, err
}

func (h *Handler) updateOrderStatus(id, status string) (model.Order, error) {
	var o model.Order
	err := h.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Raw("SELECT * FROM orders WHERE id = ? FOR UPDATE", id).Scan(&o).Error; err != nil {
			return err
		}
		if o.ID == 0 {
			return &orderRequestError{http.StatusNotFound, "order not found"}
		}
		return h.transitionOrder(tx, &o, status)
	})
	return o, err
}

// The caller holds the order lock (or has just inserted it in this transaction).
// State, fulfillment and balance changes either all commit or all roll back.
func (h *Handler) transitionOrder(tx *gorm.DB, o *model.Order, status string) error {
	if status != "paid" && status != "cancelled" && status != "refunded" && status != "pending" {
		return orderInvalid("invalid order status")
	}
	if status == o.Status {
		return nil
	}
	if !(o.Status == "pending" && (status == "paid" || status == "cancelled") || o.Status == "paid" && status == "refunded") {
		return &orderRequestError{http.StatusConflict, fmt.Sprintf("cannot change %s order to %s", o.Status, status)}
	}
	// Customer lock serializes different orders for the same subscription. The
	// order lock alone only prevents duplicate fulfillment of one order.
	var customer model.Customer
	if err := tx.Raw("SELECT * FROM customers WHERE id = ? FOR UPDATE", o.CustomerID).Scan(&customer).Error; err != nil {
		return err
	}
	if customer.ID == 0 || (status == "paid" && customer.Status != "active" && customer.Status != "suspended") {
		return orderInvalid("account disabled")
	}
	now := time.Now().UTC().Truncate(time.Second)
	if status == "paid" {
		var plan model.Plan
		if err := tx.Raw("SELECT * FROM plans WHERE id = ?", o.PlanID).Scan(&plan).Error; err != nil {
			return err
		}
		if plan.ID == 0 || plan.DurationDays <= 0 {
			return orderInvalid("invalid plan")
		}
		if err := tx.Exec("INSERT INTO order_fulfillments (order_id) VALUES (?)", o.ID).Error; err != nil {
			return err
		}
		if err := fulfillSubscriptionOrder(tx, o, plan, now); err != nil {
			return err
		}
		if err := h.creditOrderReferral(tx, o); err != nil {
			return err
		}
		if err := tx.Exec("UPDATE customers SET status = 'active', updated_at = ? WHERE id = ? AND status = 'suspended'", now, o.CustomerID).Error; err != nil {
			return err
		}
		if err := tx.Exec("UPDATE orders SET status = 'paid', paid_at = ?, updated_at = ? WHERE id = ?", now, now, o.ID).Error; err != nil {
			return err
		}
	} else {
		if status == "refunded" {
			var f struct {
				OrderID        uint
				SubscriptionID *uint
				ReferralID     *uint
			}
			if err := tx.Raw("SELECT * FROM order_fulfillments WHERE order_id = ?", o.ID).Scan(&f).Error; err != nil {
				return err
			}
			if f.OrderID == 0 {
				return &orderRequestError{http.StatusConflict, "legacy order requires fulfillment reconciliation before refund"}
			}
			if f.SubscriptionID != nil {
				if err := refundSubscriptionOrder(tx, o.ID, *f.SubscriptionID, now); err != nil {
					return err
				}
			}
			if f.ReferralID != nil {
				if err := changeReferralStatus(tx, *f.ReferralID, "cancelled"); err != nil {
					return err
				}
			}
		}
		if !o.BalanceReturned && o.BalanceDeducted > 0 {
			if err := tx.Exec("UPDATE customers SET balance = balance + ? WHERE id = ?", o.BalanceDeducted, o.CustomerID).Error; err != nil {
				return err
			}
		}
		if err := tx.Exec("UPDATE orders SET status = ?, balance_returned = TRUE, updated_at = ? WHERE id = ?", status, now, o.ID).Error; err != nil {
			return err
		}
		o.BalanceReturned = true
	}
	o.Status = status
	return nil
}

func (h *Handler) creditOrderReferral(tx *gorm.DB, o *model.Order) error {
	var referrer *uint
	if err := tx.Raw("SELECT referred_by FROM customers WHERE id = ?", o.CustomerID).Scan(&referrer).Error; err != nil {
		return err
	}
	if referrer == nil || *referrer == 0 || *referrer == o.CustomerID {
		return nil
	}
	rate := h.Config.ReferralRate
	if rate <= 0 || rate > 100 {
		rate = 10
	}
	// Only externally paid funds earn commission; recycling credit must not mint money.
	commission := o.Amount * rate / 100
	if commission <= 0 {
		return nil
	}
	if err := tx.Exec(`INSERT INTO referrals (referrer_id, referee_id, order_id, commission, status, created_at)
        VALUES (?,?,?,?,'pending',?)`, *referrer, o.CustomerID, o.ID, commission, time.Now().UTC()).Error; err != nil {
		return err
	}
	var rid uint
	if err := tx.Raw("SELECT LAST_INSERT_ID()").Scan(&rid).Error; err != nil {
		return err
	}
	if err := tx.Exec("UPDATE order_fulfillments SET referral_id = ? WHERE order_id = ?", rid, o.ID).Error; err != nil {
		return err
	}
	return tx.Exec("UPDATE customers SET balance = balance + ? WHERE id = ?", commission, *referrer).Error
}

// All non-cancelled referrals have already been credited, including pending ones.
func changeReferralStatus(tx *gorm.DB, id uint, status string) error {
	var ref model.Referral
	if err := tx.Raw("SELECT * FROM referrals WHERE id = ? FOR UPDATE", id).Scan(&ref).Error; err != nil {
		return err
	}
	if ref.ID == 0 {
		return &orderRequestError{404, "referral not found"}
	}
	if ref.Status == status {
		return nil
	}
	delta := 0
	if ref.Status != "cancelled" && status == "cancelled" {
		delta = -ref.Commission
	}
	if ref.Status == "cancelled" && status != "cancelled" {
		delta = ref.Commission
	}
	if delta != 0 {
		// Preserve debt if a credited commission was already spent. Clamping to
		// zero would manufacture credit when a cancelled referral is restored.
		if err := tx.Exec("UPDATE customers SET balance = balance + ? WHERE id = ?", delta, ref.ReferrerID).Error; err != nil {
			return err
		}
	}
	return tx.Exec("UPDATE referrals SET status = ? WHERE id = ?", status, id).Error
}
