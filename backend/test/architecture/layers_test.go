package architecture_test

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"toko/backend/test/testutil"
)

func productionFiles(t *testing.T, folder string, inspect func(string, *ast.File)) {
	t.Helper()
	entries, err := os.ReadDir(folder)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".go") || strings.HasSuffix(entry.Name(), "_test.go") {
			continue
		}
		path := filepath.Join(folder, entry.Name())
		file, err := parser.ParseFile(token.NewFileSet(), path, nil, 0)
		if err != nil {
			t.Fatal(err)
		}
		inspect(path, file)
	}
}

func TestHTTPAndServiceCannotAccessORM(t *testing.T) {
	for _, layer := range []string{"httpapi", "service"} {
		productionFiles(t, filepath.Join(testutil.BackendRoot(t), "internal", layer), func(path string, file *ast.File) {
			for _, spec := range file.Imports {
				name, _ := strconv.Unquote(spec.Path.Value)
				if strings.HasPrefix(name, "gorm.io/") || name == "database/sql" || strings.Contains(name, "/internal/database") {
					t.Errorf("%s: SQL/ORM dependencies belong in repository, found %s", path, name)
				}
			}
			ast.Inspect(file, func(node ast.Node) bool {
				if selector, ok := node.(*ast.SelectorExpr); ok && selector.Sel.Name == "DB" {
					t.Errorf("%s: direct DB access bypasses repository", path)
				}
				return true
			})
		})
	}
}

func TestDTOFieldsCannotEmbedPersistenceModels(t *testing.T) {
	productionFiles(t, filepath.Join(testutil.BackendRoot(t), "internal", "dto"), func(path string, file *ast.File) {
		ast.Inspect(file, func(node ast.Node) bool {
			structure, ok := node.(*ast.StructType)
			if !ok {
				return true
			}
			for _, field := range structure.Fields.List {
				ast.Inspect(field.Type, func(node ast.Node) bool {
					selector, ok := node.(*ast.SelectorExpr)
					if !ok {
						return true
					}
					if pkg, ok := selector.X.(*ast.Ident); ok && (pkg.Name == "model" || pkg.Name == "service" || pkg.Name == "repository") {
						t.Errorf("%s: DTO field exposes %s.%s; declare an explicit transport type", path, pkg.Name, selector.Sel.Name)
					}
					return true
				})
			}
			return true
		})
	})
}
