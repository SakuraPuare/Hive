package handler

import (
	"crypto/rand"
	"encoding/hex"
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
