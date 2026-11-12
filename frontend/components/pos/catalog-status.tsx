import type { useProductCatalog } from '@/lib/use-product-catalog'
import { Button } from '@/components/ui/button'
import { ProductPageEnd } from './product-page-end'

export function CatalogStatus({ catalog }: { catalog: ReturnType<typeof useProductCatalog> }) {
  return (
    <>
      {catalog.error && (
        <div role="alert" className="p-3 text-sm text-destructive">
          Gagal memuat produk: {catalog.error}
          <Button variant="ghost" onClick={catalog.retry}>
            Coba lagi
          </Button>
        </div>
      )}
      {catalog.loadingNext && (
        <p role="status" className="product-page-end">
          Memuat produk…
        </p>
      )}
      {catalog.hasNext && !catalog.loadingNext && !catalog.error && (
        <ProductPageEnd endRef={catalog.endRef} />
      )}
    </>
  )
}
