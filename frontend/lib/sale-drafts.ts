import type { CartLine } from './types'
import { validIncomeDate } from './income-date'

export type SaleSlot = number
export type SaleDraft = {
  id: number
  cart: CartLine[]
  methodID: number | null
  paid: string
  reference: string
  print: boolean
  incomeDate?: string
}
export type SaleDrafts = { version: 2; active: SaleSlot; nextId: number; drafts: SaleDraft[] }
export const emptySaleDraft = (id = 0): SaleDraft => ({
  id,
  cart: [],
  methodID: null,
  paid: '',
  reference: '',
  print: false,
  incomeDate: '',
})
export const emptySaleDrafts = (): SaleDrafts => ({
  version: 2,
  active: 0,
  nextId: 1,
  drafts: [emptySaleDraft()],
})

function validDraft(value: unknown): value is SaleDraft {
  if (!value || typeof value !== 'object') return false
  const draft = value as SaleDraft
  const amount = (value: unknown) =>
    typeof value === 'string' && /^(\d+(?:\.\d*)?)?$/.test(value) && value.length <= 24
  const money = (value: unknown) =>
    typeof value === 'string' && /^\d+(?:\.\d{1,2})?$/.test(value) && value.length <= 24
  return (
    Array.isArray(draft.cart) &&
    draft.cart.length <= 200 &&
    draft.cart.every(
      (line) =>
        line &&
        line.product &&
        Number.isSafeInteger(line.product.id) &&
        line.product.id > 0 &&
        typeof line.product.nama === 'string' &&
        typeof line.product.sku === 'string' &&
        money(line.product.harga_jual) &&
        amount(line.quantity) &&
        money(line.price) &&
        money(line.discount),
    ) &&
    new Set(draft.cart.map((line) => line.product.id)).size === draft.cart.length &&
    (draft.methodID === null || (Number.isSafeInteger(draft.methodID) && draft.methodID > 0)) &&
    amount(draft.paid) &&
    typeof draft.reference === 'string' &&
    typeof draft.print === 'boolean' &&
    (draft.incomeDate === undefined ||
      draft.incomeDate === '' ||
      (typeof draft.incomeDate === 'string' && validIncomeDate(draft.incomeDate)))
  )
}

export function parseSaleDrafts(text: string): SaleDrafts {
  const value = JSON.parse(text) as Omit<SaleDrafts, 'version'> & { version: number }
  if (
    (value?.version !== 1 && value?.version !== 2) ||
    !Array.isArray(value.drafts) ||
    !value.drafts.length ||
    !Number.isSafeInteger(value.active) ||
    value.active < 0 ||
    value.active >= value.drafts.length ||
    !value.drafts.every(validDraft)
  ) {
    throw new Error('Data keranjang tersimpan tidak valid.')
  }
  if (value.version === 1)
    return {
      version: 2,
      active: value.active,
      nextId: value.drafts.length,
      drafts: value.drafts.map((draft, id) => ({ ...draft, id })),
    }
  if (
    !value.drafts.every((draft) => Number.isSafeInteger(draft.id) && draft.id >= 0) ||
    new Set(value.drafts.map((draft) => draft.id)).size !== value.drafts.length ||
    !Number.isSafeInteger(value.nextId) ||
    value.nextId <= Math.max(...value.drafts.map((draft) => draft.id))
  )
    throw new Error('Identitas transaksi tersimpan tidak valid.')
  return { ...value, version: 2 }
}

export function updateSaleDraft(
  state: SaleDrafts,
  slot: SaleSlot,
  patch: Partial<Omit<SaleDraft, 'id'>>,
): SaleDrafts {
  if (!Number.isSafeInteger(slot) || slot < 0 || slot >= state.drafts.length)
    throw new Error('Transaksi tidak ditemukan.')
  const drafts: SaleDrafts['drafts'] = [...state.drafts]
  drafts[slot] = { ...drafts[slot], ...patch }
  return { ...state, drafts }
}

export function addSaleDraft(state: SaleDrafts): SaleDrafts {
  return {
    ...state,
    active: state.drafts.length,
    nextId: state.nextId + 1,
    drafts: [...state.drafts, emptySaleDraft(state.nextId)],
  }
}

export function removeSaleDraft(state: SaleDrafts, slot: SaleSlot): SaleDrafts {
  if (!Number.isSafeInteger(slot) || slot < 0 || slot >= state.drafts.length)
    throw new Error('Transaksi tidak ditemukan.')
  if (slot === 0) return state // Tab pertama adalah tab utama dan selalu dipertahankan.
  const drafts = state.drafts.filter((_, index) => index !== slot)
  const active =
    state.active > slot
      ? state.active - 1
      : state.active === slot
        ? Math.min(slot, drafts.length - 1)
        : state.active
  return { ...state, drafts, active }
}

// Hanya dipanggil setelah server mengonfirmasi status SELESAI.
export function completeSaleDraft(state: SaleDrafts, id: number): SaleDrafts {
  const slot = state.drafts.findIndex((draft) => draft.id === id)
  if (slot < 0) return state
  if (slot === 0)
    return {
      ...updateSaleDraft(state, 0, {
        cart: [],
        paid: '',
        reference: '',
        methodID: null,
        incomeDate: '',
      }),
      active: 0,
    }
  return { ...removeSaleDraft(state, slot), active: 0 }
}

// Tab pertama tetap memakai key lama, sehingga request pending sebelum fitur ini tidak hilang.
export function checkoutStorageKey(
  userID: number,
  kind: 'penjualan' | 'pembelian',
  slot: SaleSlot = 0,
) {
  if (!Number.isSafeInteger(slot) || slot < 0) throw new Error('Transaksi tidak valid.')
  return `toko:pending:${userID}:${kind}${slot === 0 ? '' : `:${slot + 1}`}`
}
