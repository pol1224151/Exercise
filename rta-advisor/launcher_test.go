package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPackedAppServesThePageAndVersion(t *testing.T) {
	dir := t.TempDir()
	if err := syncApp(dir); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "index.html")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "data", "catalog.json")); err != nil {
		t.Fatal(err)
	}

	server := httptest.NewServer(newHandler(dir))
	defer server.Close()

	page, err := http.Get(server.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	defer page.Body.Close()
	body, _ := io.ReadAll(page.Body)
	if page.StatusCode != 200 || !strings.Contains(string(body), "帳號與設定") || !strings.Contains(string(body), "下一步") || !strings.Contains(string(body), "沒有收到畫面") {
		t.Fatalf("page status %d", page.StatusCode)
	}

	version, err := http.Get(server.URL + "/api/version")
	if err != nil {
		t.Fatal(err)
	}
	defer version.Body.Close()
	var payload map[string]any
	if err := json.NewDecoder(version.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload["ok"] != true || payload["season"] == "" {
		t.Fatalf("version %#v", payload)
	}

	kept := filepath.Join(dir, "data", "version.json")
	original, err := os.ReadFile(kept)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(kept, []byte(`{"season":"kept-by-user"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := syncApp(dir); err != nil {
		t.Fatal(err)
	}
	after, err := os.ReadFile(kept)
	if err != nil {
		t.Fatal(err)
	}
	if string(after) != `{"season":"kept-by-user"}` {
		t.Fatal("a second open of the same exe overwrote updated data")
	}
	if err := os.WriteFile(kept, original, 0o644); err != nil {
		t.Fatal(err)
	}
}
