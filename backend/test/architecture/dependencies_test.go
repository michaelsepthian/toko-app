package architecture_test

import (
	"go/ast"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"toko/backend/test/testutil"
)

// Batas dependency menjaga agar aturan bisnis dapat diuji tanpa transport HTTP,
// dan model/repository tidak bergantung kembali pada layer pemakainya.
func TestLayerDependencyDirection(t *testing.T) {
	for _, test := range []struct {
		layer     string
		forbidden []string
	}{
		{"model", []string{"dto", "service", "httpapi", "repository", "database", "config"}},
		{"repository", []string{"dto", "service", "httpapi"}},
		{"service", []string{"dto", "httpapi"}},
	} {
		t.Run(test.layer, func(t *testing.T) {
			productionFiles(t, filepath.Join(testutil.BackendRoot(t), "internal", test.layer), func(path string, file *ast.File) {
				for _, spec := range file.Imports {
					name, err := strconv.Unquote(spec.Path.Value)
					if err != nil {
						t.Fatal(err)
					}
					for _, forbidden := range test.forbidden {
						prefix := "toko/backend/internal/" + forbidden
						if name == prefix || strings.HasPrefix(name, prefix+"/") {
							t.Errorf("%s: %s cannot depend on %s", path, test.layer, name)
						}
					}
					if test.layer == "service" && (name == "net/http" || strings.HasPrefix(name, "net/http/")) {
						t.Errorf("%s: HTTP transport belongs outside business services", path)
					}
				}
			})
		})
	}
}
