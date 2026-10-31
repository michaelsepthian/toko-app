package httpapi

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"

	"toko/backend/internal/model"
)

func TestCatalogCacheConcurrentRequestsAndInvalidation(t *testing.T) {
	var loads atomic.Int32
	cache := newCatalogCache(func(context.Context) (masterData, error) {
		loads.Add(1)
		return masterData{Products: []model.Produk{}}, nil
	})
	before := cache.version()
	var wg sync.WaitGroup
	for i := 0; i < 25; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			data, err := cache.get(context.Background())
			if err != nil || data.Version != before || data.Products == nil {
				t.Errorf("invalid cached snapshot: %+v, %v", data, err)
			}
		}()
	}
	wg.Wait()
	if loads.Load() != 1 {
		t.Fatalf("got %d DB loads, want 1", loads.Load())
	}
	cache.invalidate()
	if cache.version() == before {
		t.Fatal("version unchanged after mutation")
	}
	data, err := cache.get(context.Background())
	if err != nil || data.Version == before || loads.Load() != 2 {
		t.Fatal("cache did not reload after invalidation", err)
	}
}

func TestCatalogCacheRetriesFailedLoad(t *testing.T) {
	calls := 0
	cache := newCatalogCache(func(context.Context) (masterData, error) {
		calls++
		if calls == 1 {
			return masterData{}, errors.New("temporary database failure")
		}
		return masterData{}, nil
	})
	if _, err := cache.get(context.Background()); err == nil {
		t.Fatal("want load error")
	}
	if _, err := cache.get(context.Background()); err != nil || calls != 2 {
		t.Fatal("failure was cached", err)
	}
}

func TestCatalogCashierDoesNotReceiveOrModifyCachedSources(t *testing.T) {
	data := masterData{Sources: []model.SumberPembelian{{Nama: "Owner only"}}}
	if len(data.forUser(false).Sources) != 0 {
		t.Fatal("cashier received purchase sources")
	}
	if len(data.forUser(true).Sources) != 1 {
		t.Fatal("filter modified shared snapshot")
	}
}
