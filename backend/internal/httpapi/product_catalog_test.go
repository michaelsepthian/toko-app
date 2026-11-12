package httpapi

import (
	"errors"
	"fmt"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"toko/backend/internal/model"
)

func TestProductCatalogParameters(t *testing.T) {
	for _, query := range []string{"limit=0", "limit=101", "limit=no", "sort=id;DROP", "aktif=yes", "favorites_first=1", "q=" + strings.Repeat("a", 301)} {
		if _, err := parseProductCatalog(httptest.NewRequest("GET", "/?"+query, nil)); err == nil {
			t.Error("accepted", query)
		}
	}
	o, err := parseProductCatalog(httptest.NewRequest("GET", "/?q=beras++putih", nil))
	if err != nil || o.Limit != 50 || o.Query != "beras putih" || o.Sort != "name-asc" || o.Active != "true" {
		t.Fatal(o, err)
	}
}

func TestProductPageCacheTTLBoundRefreshAndErrors(t *testing.T) {
	cache := &productPageCache{ttl: 30 * time.Second}
	clock := time.Now()
	now := func() time.Time { return clock }
	var calls atomic.Int32
	load := func() (productPage, error) { calls.Add(1); return productPage{Items: []model.Produk{}}, nil }
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := cache.get("one", false, now, load); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if calls.Load() != 1 {
		t.Fatal("cold requests not coalesced", calls.Load())
	}
	_, _ = cache.get("one", true, now, load)
	clock = clock.Add(31 * time.Second)
	_, _ = cache.get("one", false, now, load)
	if calls.Load() != 3 {
		t.Fatal("refresh/expiry did not reload", calls.Load())
	}
	for i := 0; i < 80; i++ {
		_, _ = cache.get(fmt.Sprint(i), false, now, load)
	}
	if len(cache.entries) > 32 {
		t.Fatal("cache exceeded capacity")
	}
	_, err := cache.get("error", false, now, func() (productPage, error) { return productPage{}, errors.New("DB down") })
	if err == nil {
		t.Fatal("missing error")
	}
	if _, ok := cache.entries["error"]; ok {
		t.Fatal("cached failure")
	}
}

func TestProductPageCacheDefaultTTLIsOneHour(t *testing.T) {
	cache := &productPageCache{}
	clock := time.Now()
	now := func() time.Time { return clock }
	calls := 0
	load := func() (productPage, error) { calls++; return productPage{}, nil }
	_, _ = cache.get("page", false, now, load)
	clock = clock.Add(30 * time.Minute)
	_, _ = cache.get("page", false, now, load)
	if calls != 1 {
		t.Fatal("default cache expired before one hour")
	}
	clock = clock.Add(30 * time.Minute)
	_, _ = cache.get("page", false, now, load)
	if calls != 2 {
		t.Fatal("default cache did not expire after one hour")
	}
}
