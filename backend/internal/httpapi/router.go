package httpapi

import (
	"net/http"

	"toko/backend/internal/config"
	"toko/backend/internal/repository"
	"toko/backend/internal/service"
)

func New(c config.Config, store *repository.Store) http.Handler {
	api := http.NewServeMux()
	svc := &service.Service{Store: store, JWTKey: c.JWTKey}
	registerUsers(api, svc)
	catalog := registerCatalog(api, svc, c.ProductCacheTTL)
	registerMasters(api, svc, catalog.invalidate)
	registerDailySummaries(api, svc)
	registerCashPurchaseNotes(api, svc)
	registerShoppingPlans(api, svc)
	registerTransactions(api, svc, false)
	registerTransactions(api, svc, true)
	registerStock(api, svc)
	root := http.NewServeMux()
	auth := NewAuth(c.JWTKey, store)
	registerSetup(root, svc, c)
	registerSession(api, root, svc, c)
	registerHealth(root, store)
	root.Handle("/api/", auth.Middleware(api))
	return middleware(root, c.CORSOrigin)
}
