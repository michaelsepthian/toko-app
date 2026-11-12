// Package testutil menyediakan helper khusus pengujian, bukan dependency aplikasi.
package testutil

import (
	"os"
	"path/filepath"
	"testing"
)

// BackendRoot tidak bergantung pada kedalaman folder suatu suite test.
func BackendRoot(t testing.TB) string {
	t.Helper()
	directory, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	for {
		if info, err := os.Stat(filepath.Join(directory, "go.mod")); err == nil && !info.IsDir() {
			return directory
		}
		parent := filepath.Dir(directory)
		if parent == directory {
			t.Fatal("backend go.mod tidak ditemukan")
		}
		directory = parent
	}
}

func DatabasePath(t testing.TB, parts ...string) string {
	t.Helper()
	root := filepath.Join(BackendRoot(t), "..", "database")
	return filepath.Join(append([]string{root}, parts...)...)
}
