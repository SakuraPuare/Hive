package handler

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"regexp"
	"strings"

	"hive/registry/internal/model"
)

// minPasswordLength is the minimum allowed password length.
const minPasswordLength = 8

// emailRegexp validates basic email format.
var emailRegexp = regexp.MustCompile(`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)

// isValidPassword checks that the password meets the minimum length requirement.
func isValidPassword(pw string) bool {
	return len(pw) >= minPasswordLength
}

// isValidEmail checks that the email matches a basic format.
func isValidEmail(email string) bool {
	return emailRegexp.MatchString(email)
}

// buildNodeName constructs the subscription node display name.
func buildNodeName(n model.Node) string {
	name := ""
	if n.Location != "" {
		name += "【" + n.Location + "】"
	}
	if n.Note != "" {
		name += n.Note + " - "
	}
	name += n.Hostname
	return name
}

// stripScheme removes https:// or http:// prefix.
func stripScheme(rawURL string) string {
	rawURL = strings.TrimPrefix(rawURL, "https://")
	rawURL = strings.TrimPrefix(rawURL, "http://")
	return strings.TrimSuffix(rawURL, "/")
}

// yamlStr wraps a string in double quotes for YAML output.
func yamlStr(s string) string {
	s = strings.ReplaceAll(s, `"`, `\"`)
	return `"` + s + `"`
}

// generateToken returns a 64-char hex random token.
func generateToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// generateUUID returns a random RFC 4122 version 4 UUID string.
// Used as the per-subscription Xray VLESS client id.
func generateUUID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // variant 10
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16]), nil
}

// crockfordBase32 is the Crockford alphabet (no I/L/O/U to avoid ambiguity),
// used for human-readable device claim codes shown on MOTD/stickers.
const crockfordBase32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

// generateClaimCode returns an 8-char Crockford-base32 device claim code
// formatted "XXXX-XXXX". The plaintext is returned to the device once at
// registration; the server persists only its sha256 (see hashClaimCode).
func generateClaimCode() (string, error) {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	out := make([]byte, 0, 9)
	for i, v := range b {
		if i == 4 {
			out = append(out, '-')
		}
		out = append(out, crockfordBase32[int(v)%len(crockfordBase32)])
	}
	return string(out), nil
}

// hashClaimCode returns the sha256 hex of a claim code, normalized (uppercased,
// dashes/spaces stripped) so user input matches regardless of formatting.
func hashClaimCode(code string) string {
	norm := strings.ToUpper(strings.NewReplacer("-", "", " ", "").Replace(strings.TrimSpace(code)))
	sum := sha256.Sum256([]byte(norm))
	return hex.EncodeToString(sum[:])
}
