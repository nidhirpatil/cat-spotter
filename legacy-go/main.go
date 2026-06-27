// Cat Spotter — a tiny site for a community-cat care group. Anyone can mark a
// cat as "seen", and the home page shows when each cat was last spotted.
package main

import (
	"crypto/rand"
	"encoding/hex"
	"html/template"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	dataFile   = "data/cats.json"
	uploadsDir = "uploads"
	maxUpload  = 8 << 20 // 8 MiB
)

type server struct {
	store *Store
	tmpl  map[string]*template.Template
}

func main() {
	store, err := NewStore(dataFile)
	if err != nil {
		log.Fatalf("loading store: %v", err)
	}

	// Each page is parsed together with the shared layout into its own set,
	// so every page can define its own "content" block without colliding.
	funcs := template.FuncMap{"ago": humanizeAgo}
	tmpl := map[string]*template.Template{}
	for _, page := range []string{"index.html", "add.html"} {
		tmpl[page] = template.Must(template.New(page).Funcs(funcs).
			ParseFiles("templates/layout.html", "templates/"+page))
	}

	s := &server{store: store, tmpl: tmpl}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /", s.handleIndex)
	mux.HandleFunc("GET /add", s.handleAddForm)
	mux.HandleFunc("POST /add", s.handleAdd)
	mux.HandleFunc("POST /spot", s.handleSpot)
	mux.Handle("GET /static/", http.StripPrefix("/static/", http.FileServer(http.Dir("static"))))
	mux.Handle("GET /uploads/", http.StripPrefix("/uploads/", http.FileServer(http.Dir(uploadsDir))))

	addr := ":8080"
	if p := os.Getenv("PORT"); p != "" {
		addr = ":" + p
	}
	log.Printf("Cat Spotter listening on http://localhost%s", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}

func (s *server) handleIndex(w http.ResponseWriter, r *http.Request) {
	s.render(w, "index.html", map[string]any{"Cats": s.store.List()})
}

func (s *server) handleAddForm(w http.ResponseWriter, r *http.Request) {
	s.render(w, "add.html", nil)
}

func (s *server) handleAdd(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(maxUpload); err != nil {
		http.Error(w, "could not parse form", http.StatusBadRequest)
		return
	}

	name := strings.TrimSpace(r.FormValue("name"))
	if name == "" {
		http.Error(w, "a cat needs a name", http.StatusBadRequest)
		return
	}

	imageURL, err := s.saveUpload(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	cat := &Cat{ID: newID(), Name: name, ImageURL: imageURL}
	if err := s.store.Add(cat); err != nil {
		http.Error(w, "could not save cat", http.StatusInternalServerError)
		return
	}
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

func (s *server) handleSpot(w http.ResponseWriter, r *http.Request) {
	id := r.FormValue("id")
	if err := s.store.Spot(id, time.Now()); err != nil {
		http.Error(w, "cat not found", http.StatusNotFound)
		return
	}
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

// saveUpload writes an optional uploaded picture to the uploads dir and returns
// its public URL. Returns an empty URL when no file was provided.
func (s *server) saveUpload(r *http.Request) (string, error) {
	file, header, err := r.FormFile("picture")
	if err == http.ErrMissingFile {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	defer file.Close()

	ext := strings.ToLower(filepath.Ext(header.Filename))
	switch ext {
	case ".jpg", ".jpeg", ".png", ".gif", ".webp":
	default:
		return "", errPic
	}

	name := newID() + ext
	dst, err := os.Create(filepath.Join(uploadsDir, name))
	if err != nil {
		return "", err
	}
	defer dst.Close()

	if _, err := io.Copy(dst, file); err != nil {
		return "", err
	}
	return "/uploads/" + name, nil
}

func (s *server) render(w http.ResponseWriter, name string, data any) {
	t, ok := s.tmpl[name]
	if !ok {
		http.Error(w, "unknown page", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := t.ExecuteTemplate(w, "layout", data); err != nil {
		log.Printf("render %s: %v", name, err)
		http.Error(w, "internal error", http.StatusInternalServerError)
	}
}

var errPic = errorString("picture must be a jpg, png, gif, or webp")

type errorString string

func (e errorString) Error() string { return string(e) }

// newID returns a short random hex id.
func newID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// humanizeAgo renders a *time.Time as a friendly "spotted X ago" string.
func humanizeAgo(t *time.Time) string {
	if t == nil {
		return "never spotted yet"
	}
	d := time.Since(*t)
	switch {
	case d < time.Minute:
		return "just now"
	case d < time.Hour:
		return plural(int(d.Minutes()), "minute") + " ago"
	case d < 24*time.Hour:
		return plural(int(d.Hours()), "hour") + " ago"
	default:
		return plural(int(d.Hours()/24), "day") + " ago"
	}
}

func plural(n int, unit string) string {
	s := strconv.Itoa(n) + " " + unit
	if n != 1 {
		s += "s"
	}
	return s
}
