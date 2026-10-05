export type JobState =
  | "Queued"
  | "Processing"
  | "Completed"
  | "Partial"
  | "Failed"
  | "Cancelled";
export type RetailerState =
  | "Pending"
  | "Checking"
  | "Exact"
  | "Likely"
  | "Possible"
  | "NotFound"
  | "Unavailable"
  | "CheckFailed"
  | "NotSupported";
export interface Session {
  account: {
    id: number;
    displayName: string;
    isTrial: boolean;
    isPaid?: boolean;
    expiresDate: string | null;
  };
  shoppingListId: number | null;
  sessionExpiresDate: string;
}
export interface Accepted {
  jobId: number;
  status: JobState;
  quantity: number;
  reused: boolean;
  statusUrl: string;
}
export interface ImportPage {
  items: { jobId: number; status: JobState; createdDate: string }[];
  nextBeforeId: number | null;
}
export interface ListItem {
  listArchived?: boolean;
  id: number;
  shoppingListId: number;
  product: NonNullable<Job["product"]>;
  quantity: number;
  notes: string | null;
  isPurchased: boolean;
  purchasedDate: string | null;
  isHidden: boolean;
  preferredShopId: number | null;
  addedDate: string;
  updatedDate: string;
}
export interface ShoppingListSummary {
  id: number;
  name: string;
  createdDate: string;
  updatedDate: string;
}
export interface ShoppingListManagement {
  limit: number;
  isPaid: boolean;
  lists: ShoppingListSummary[];
}
export interface ShoppingListHistory {
  list: ShoppingListSummary;
  items: ListItem[];
}
export interface ListItemPage {
  items: ListItem[];
  nextBeforeId: number | null;
}
export interface PlanningPrice {
  multibuy?: {
    quantity: number;
    total: number;
    unitPrice: number;
    savings: number;
  } | null;
  refreshStatus?: "Waiting" | "Updating" | "RetryLater" | null;
  shopId: number;
  shopName: string;
  price: number | null;
  includedInTotal: boolean;
  status: string;
  productUrl: string | null;
  checkedDate: string | null;
  specialDescription: string | null;
}
export interface PlanningItem {
  item: ListItem;
  prices: PlanningPrice[];
}
export interface PlanningBasket {
  shopId: number | null;
  name: string;
  subtotal: number;
  pricedCount: number;
  missingItems: { itemId: number; name: string; reason: string }[];
}
export interface ShoppingListPlan {
  id: number;
  name: string;
  items: PlanningItem[];
  lowest: PlanningBasket;
  retailers: PlanningBasket[];
}
export interface InStoreRetailer {
  id: number;
  name: string;
}
export interface InStoreList {
  id: number;
  name: string;
  remainingCount: number;
  retailers: InStoreRetailer[];
}
export interface InStorePrice {
  shopId: number;
  shopName: string;
  price: number | null;
  status: string;
  checkedDate: string | null;
}
export interface InStoreItem {
  item: ListItem;
  prices: InStorePrice[];
}
export interface InStoreDetail {
  id: number;
  name: string;
  retailers: InStoreRetailer[];
  items: InStoreItem[];
  remainingCount: number;
  baskets: {
    shopId: number;
    shopName: string;
    subtotal: number;
    pricedCount: number;
    comparableSubtotal: number;
    savingsBySplitting: number;
  }[];
  splitSubtotal: number;
  splitPricedCount: number;
  comparableCount: number;
  comparableSplitSubtotal: number;
}
export interface ListItemUpdate {
  quantity: number;
  notes: string | null;
  isPurchased: boolean;
  isHidden: boolean;
  expectedUpdatedDate: string;
}
export interface Price {
  price: number;
  normalPrice: number | null;
  unitPrice: number | null;
  currency: string;
  shopLocationId: number | null;
  priceScope: string;
  sourceType: string;
  sourceUrl: string;
  checkedDate: string;
  inStock: boolean | null;
  specialType: string | null;
  specialDescription: string | null;
  specialStartDate: string | null;
  specialEndDate: string | null;
}
export interface Retailer {
  shopId: number;
  shopName: string;
  status: RetailerState;
  matchType: string | null;
  matchConfidence: number | null;
  isFromCache: boolean;
  checkedDate: string | null;
  errorCode: string | null;
  prices: Price[];
}
export interface Job {
  jobId: number;
  shoppingListId: number;
  status: JobState;
  progressStage: string;
  quantity: number;
  shoppingListProductId: number | null;
  product: {
    id: number;
    name: string;
    brand: string | null;
    variant: string | null;
    packQuantity: number | null;
    packSize: number | null;
    packUnit: string | null;
    imageUrl: string | null;
  } | null;
  createdDate: string;
  lastActivityDate: string | null;
  completedDate: string | null;
  nextAttemptDate: string | null;
  errorCode: string | null;
  retailers: Retailer[];
}
export function isActive(job: Job) {
  return job.status === "Queued" || job.status === "Processing";
}
export function placeholder(jobId: number, listId: number, quantity = 1): Job {
  return {
    jobId,
    shoppingListId: listId,
    quantity,
    status: "Queued",
    progressStage: "Queued",
    product: null,
    shoppingListProductId: null,
    createdDate: new Date().toISOString(),
    lastActivityDate: null,
    completedDate: null,
    nextAttemptDate: null,
    errorCode: null,
    retailers: [],
  };
}
