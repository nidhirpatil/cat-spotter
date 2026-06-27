package main

import (
	"encoding/json"
	"errors"
	"os"
	"sort"
	"sync"
	"time"
)

// Cat is a single community cat we look after.
type Cat struct {
	ID       string     `json:"id"`
	Name     string     `json:"name"`
	ImageURL string     `json:"image_url"`
	LastSeen *time.Time `json:"last_seen,omitempty"`
}

// Store keeps all cats in memory and persists them to a JSON file. It is safe
// for concurrent use — every read and write holds the mutex.
type Store struct {
	mu   sync.RWMutex
	path string
	cats map[string]*Cat
}

// NewStore loads cats from path, creating an empty store if the file is absent.
func NewStore(path string) (*Store, error) {
	s := &Store{path: path, cats: make(map[string]*Cat)}

	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, err
	}

	var cats []*Cat
	if err := json.Unmarshal(data, &cats); err != nil {
		return nil, err
	}
	for _, c := range cats {
		s.cats[c.ID] = c
	}
	return s, nil
}

// save writes the current state to disk. Callers must hold the lock.
func (s *Store) save() error {
	cats := make([]*Cat, 0, len(s.cats))
	for _, c := range s.cats {
		cats = append(cats, c)
	}
	data, err := json.MarshalIndent(cats, "", "  ")
	if err != nil {
		return err
	}
	// Write atomically so a crash mid-write can't corrupt the file.
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

// List returns all cats sorted so the most recently spotted appear first.
// Cats never spotted sort last, alphabetically by name.
func (s *Store) List() []*Cat {
	s.mu.RLock()
	defer s.mu.RUnlock()

	cats := make([]*Cat, 0, len(s.cats))
	for _, c := range s.cats {
		cats = append(cats, c)
	}
	sort.Slice(cats, func(i, j int) bool {
		a, b := cats[i], cats[j]
		switch {
		case a.LastSeen != nil && b.LastSeen != nil:
			return a.LastSeen.After(*b.LastSeen)
		case a.LastSeen != nil:
			return true // a seen, b never seen
		case b.LastSeen != nil:
			return false // b seen, a never seen
		default:
			return a.Name < b.Name
		}
	})
	return cats
}

// Add stores a new cat.
func (s *Store) Add(c *Cat) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cats[c.ID] = c
	return s.save()
}

// Spot records that a cat was seen at time t.
func (s *Store) Spot(id string, t time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	c, ok := s.cats[id]
	if !ok {
		return errors.New("cat not found")
	}
	c.LastSeen = &t
	return s.save()
}
