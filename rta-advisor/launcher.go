package main

import (
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// packVersion is written next to the extracted files. Bump it when shipping a new exe
// so a newer double-click replaces the packed hero data.
const packVersion = "2026-11-14.4"

const listenAddr = "127.0.0.1:8765"

//go:embed index.html
//go:embed css
//go:embed js
//go:embed data
//go:embed server.py
//go:embed tools/build-catalog.py
//go:embed tools/live_data.py
//go:embed vendor
var packed embed.FS

func main() {
	dir, err := appDir()
	if err != nil {
		fmt.Println("找不到可寫入的資料夾：", err)
		waitEnter()
		return
	}
	if err := syncApp(dir); err != nil {
		fmt.Println("沒有把顧問檔案準備好：", err)
		waitEnter()
		return
	}
	listener, err := net.Listen("tcp", listenAddr)
	if err != nil {
		fmt.Println("顧問已經在跑。請留著剛才那個視窗，不要再開一次。")
		fmt.Println("瀏覽器請開 http://127.0.0.1:8765/")
		openBrowser("http://127.0.0.1:8765/")
		waitEnter()
		return
	}
	server := &http.Server{Handler: newHandler(dir)}
	go func() {
		time.Sleep(300 * time.Millisecond)
		openBrowser("http://127.0.0.1:8765/")
	}()
	fmt.Println("第七史詩 RTA 顧問已啟動。")
	fmt.Println("瀏覽器若沒有自己打開，請打開 http://127.0.0.1:8765/")
	fmt.Println("關掉這個視窗就停止。不要先關視窗再去開網址，否則瀏覽器會說連線被拒。")
	if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
		fmt.Println(err)
		waitEnter()
	}
}

func appDir() (string, error) {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		base = home
	}
	return filepath.Join(base, "RtaAdvisor"), nil
}

func syncApp(dest string) error {
	previous, _ := os.ReadFile(filepath.Join(dest, "pack-version.txt"))
	includeData := strings.TrimSpace(string(previous)) != packVersion
	if err := extractTree(packed, dest, includeData); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dest, "pack-version.txt"), []byte(packVersion), 0o644)
}

func extractTree(packedFS embed.FS, dest string, includeData bool) error {
	return fs.WalkDir(packedFS, ".", func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !includeData && (path == "data" || strings.HasPrefix(path, "data/")) {
			if entry.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		target := filepath.Join(dest, filepath.FromSlash(path))
		if entry.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		body, err := packedFS.ReadFile(path)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		return os.WriteFile(target, body, 0o644)
	})
}

func newHandler(root string) http.Handler {
	files := http.FileServer(http.Dir(root))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.Split(r.URL.Path, "?")[0]
		if path == "/api/version" && r.Method == http.MethodGet {
			writeVersion(w, root)
			return
		}
		if path == "/api/update" && r.Method == http.MethodPost {
			io.Copy(io.Discard, r.Body)
			runUpdate(w, root)
			return
		}
		if strings.HasPrefix(path, "/api/") {
			http.NotFound(w, r)
			return
		}
		if path == "/api/version" || path == "/api/update" || strings.HasSuffix(path, ".json") {
			w.Header().Set("Cache-Control", "no-store")
		}
		files.ServeHTTP(w, r)
	})
}

func writeVersion(w http.ResponseWriter, root string) {
	body, err := os.ReadFile(filepath.Join(root, "data", "version.json"))
	if err != nil {
		respond(w, map[string]any{"ok": false, "error": "還沒有版本檔"}, http.StatusInternalServerError)
		return
	}
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		respond(w, map[string]any{"ok": false, "error": err.Error()}, http.StatusInternalServerError)
		return
	}
	payload["ok"] = true
	respond(w, payload, http.StatusOK)
}

func runUpdate(w http.ResponseWriter, root string) {
	python := findPython()
	if python == "" {
		respond(w, map[string]any{
			"ok":    false,
			"error": "頁面已經開了，不需要 Python。更新英雄、倍率與賽季才需要。這台電腦沒有 Python。請再下載新的 RtaAdvisor.exe，裡面會帶新的資料。",
		}, http.StatusInternalServerError)
		return
	}
	command := exec.Command(python, "-c", "import sys; sys.path.insert(0, 'tools'); import build_catalog; from live_data import refresh_all; refresh_all(build_catalog)")
	command.Dir = root
	output, err := command.CombinedOutput()
	if err != nil {
		message := strings.TrimSpace(string(output))
		if message == "" {
			message = err.Error()
		}
		respond(w, map[string]any{"ok": false, "error": message}, http.StatusInternalServerError)
		return
	}
	writeVersion(w, root)
}

func findPython() string {
	for _, name := range []string{"py", "python", "python3"} {
		if path, err := exec.LookPath(name); err == nil {
			return path
		}
	}
	return ""
}

func respond(w http.ResponseWriter, payload map[string]any, status int) {
	body, err := json.Marshal(payload)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	w.Write(body)
}

func waitEnter() {
	fmt.Println("按 Enter 關掉這個視窗。")
	fmt.Scanln()
}
