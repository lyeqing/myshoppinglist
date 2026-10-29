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
export interface ProductPreference {
  productId: number;
  isFavorite: boolean;
  isEssential: boolean;
}
export interface ProductLibraryItem {
  product: ListItem["product"];
  isFavorite: boolean;
  isEssential: boolean;
  lastAddedDate: string | null;
  lastPurchasedDate: string | null;
  timesAdded: number;
}
export interface ProductLibraryPage {
  accountId: number;
  items: ProductLibraryItem[];
  total: number;
  nextOffset: number | null;
}
export interface ListItemPage {
  items: ListItem[];
  nextBeforeId: number | null;
}
export interface QuantityPrice {
  quantity: number;
  total: number;
  ordinaryTotal: number;
  savings: number;
  appliedBundles: number;
  remainingQuantity: number;
}
export interface PriceRefreshResult {
  checkedUnavailable?: number;
  queued: number;
  alreadyRunning: number;
  current: number;
  deferred: number;
}
export interface PriceObservationContext {
  sourceType: string;
  priceScope: string;
  sourceUrl: string | null;
}
export interface ShoppingListSubstitutionChoice {
  shopId: number;
  shopName: string;
  product: ListItem["product"];
  quantity: number;
  status: string;
  updatedDate: string;
  offer: PackComparisonPrice | null;
  multibuy?: PlanningPrice["multibuy"];
}
export interface PlanningPrice {
  substitution?: ShoppingListSubstitutionChoice | null;
  observation?: PriceObservationContext | null;
  quantityPrice?: QuantityPrice | null;
  multibuy?: {
    quantity: number;
    total: number;
    unitPrice: number;
    savings: number;
  } | null;
  refreshStatus?: "Waiting" | "Updating" | "Paused" | "RetryLater" | null;
  shopId: number;
  shopName: string;
  price: number | null;
  includedInTotal: boolean;
  status: string;
  productUrl: string | null;
  checkedDate: string | null;
  specialDescription: string | null;
}
export interface PackComparisonPrice {
  observation?: PriceObservationContext | null;
  shopId: number;
  shopName: string;
  price: number | null;
  unitPrice: number | null;
  status: string;
  checkedDate: string | null;
  productUrl: string | null;
}
export interface PackAlternative {
  relationship: "SameProductDifferentSize";
  product: ListItem["product"];
  totalQuantity: number;
  unit: "g" | "mL";
  quantityRatio: number;
  offer: PackComparisonPrice;
  original: PackComparisonPrice | null;
  unitPriceDifferencePercent: number | null;
  packagePriceDifference: number | null;
}
export interface BrandAlternative extends Omit<
  PackAlternative,
  "relationship"
> {
  relationship: "EquivalentDifferentBrand" | "SuggestedDifferentBrand";
  label: string;
}
export interface PlanningItem {
  packAlternatives?: PackAlternative[] | null;
  brandAlternatives?: BrandAlternative[] | null;
  substitutions?: ShoppingListSubstitutionChoice[] | null;
  item: ListItem;
  prices: PlanningPrice[];
  comparison?: ItemComparison | null;
}
export interface ItemComparison {
  jobId: number;
  status: "Checking" | "Failed" | "Completed";
  errorCode: string | null;
  retryAfter: string | null;
  canRetry: boolean;
  retailers: { name: string; status: string; errorCode: string | null }[];
}
export interface PlanningBasket {
  shopId: number | null;
  name: string;
  subtotal: number;
  pricedCount: number;
  missingItems: { itemId: number; name: string; reason: string }[];
  needsChoiceCount?: number;
  substitutionCount?: number;
}
export interface ShoppingPreferences {
  accountId: number;
  compareOnlyPreferredShops: boolean;
  includeDifferentPackSizes: boolean;
  includeDifferentBrands: boolean;
  shops: { shopId: number; isEnabled: boolean }[];
  branches?: PreferredShopLocation[];
  availableShops: {
    id: number;
    name: string;
    code: string;
    comparisonSupported: boolean;
    capabilityStatus?: "Supported" | "ExtensionOnly" | "Restricted" | "NotImplemented" | null;
    capabilityMessage?: string | null;
  }[];
  updatedDate: string;
}
export interface ComparisonBranchContext extends PreferredShopLocation {
  supermarketEnabled: boolean;
}
export interface ComparisonStoreContext {
  preferredOnly: boolean;
  shopNames: string[];
  branches?: ComparisonBranchContext[] | null;
}
export interface ShoppingListPlan {
  storeContext?: ComparisonStoreContext | null;
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
  substitution?: ShoppingListSubstitutionChoice | null;
  observation?: PriceObservationContext | null;
  refreshStatus?: PlanningPrice["refreshStatus"];
  previousPrice?: number | null;
  multibuy?: PlanningPrice["multibuy"];
  quantityPrice?: QuantityPrice | null;
  shopId: number;
  shopName: string;
  price: number | null;
  status: string;
  checkedDate: string | null;
}
export interface InStoreItem {
  packAlternatives?: PackAlternative[] | null;
  brandAlternatives?: BrandAlternative[] | null;
  substitutions?: ShoppingListSubstitutionChoice[] | null;
  item: ListItem;
  prices: InStorePrice[];
}
export interface InStoreDetail {
  storeContext?: ComparisonStoreContext | null;
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
    needsChoiceCount?: number;
    substitutionCount?: number;
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

export interface PackDiscoveryProgress {
  id: number;
  itemId: number;
  productName: string;
  shopName: string;
  status:
    | "Queued"
    | "Processing"
    | "WaitingForExtension"
    | "Completed"
    | "Failed"
    | "Cancelled";
  foundCount: number;
  errorCode: string | null;
  updatedDate: string;
  retryAfter: string | null;
}
export interface PackDiscoveryView {
  accountId: number;
  listId: number;
  itemId: number | null;
  enabled: boolean;
  canStart: boolean;
  reason: string | null;
  jobs: PackDiscoveryProgress[];
  queued: number;
  alreadyRunning: number;
  recent: number;
}

export interface AdminAlternativeProductSearchItem {
  product: ListItem["product"];
  category: string | null;
  subCategory: string | null;
  isDeleted: boolean;
}
export interface AdminAlternativeProductSearchResult {
  items: AdminAlternativeProductSearchItem[];
  hasMore: boolean;
}
export interface BrandAlternativeReviewProduct extends AdminAlternativeProductSearchItem {
  description: string | null;
  itemDetail: string | null;
  gtin: string | null;
  manufacturerPartNumber: string | null;
  modelNumber: string | null;
  fingerprint: string;
}
export interface BrandAlternativeReviewResponse {
  id: number;
  productId: number;
  alternativeProductId: number;
  previousReviewId: number | null;
  approved: boolean;
  evidence: string;
  sameUseAndFormatConfirmed: boolean;
  dietaryAndCompositionChecked: boolean;
  reviewerAccountId: number;
  reviewedAt: string;
  needsReview: boolean;
}
export interface BrandAlternativeReviewContext {
  product: BrandAlternativeReviewProduct;
  alternativeProduct: BrandAlternativeReviewProduct;
  reviews: BrandAlternativeReviewResponse[];
}
export interface BrandAlternativeReviewRequest {
  approved: boolean;
  evidence: string;
  expectedReviewId: number;
  sameUseAndFormatConfirmed: boolean;
  dietaryAndCompositionChecked: boolean;
  expectedProductFingerprint: string;
  expectedAlternativeFingerprint: string;
}

export interface ShopLocationDetails {
  shopId: number;
  storeCode: string | null;
  name: string | null;
  address1: string | null;
  address2: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  isActive: boolean;
}
export interface ShopLocationSummary {
  id: number;
  shopId: number;
  shopName: string;
  storeCode: string | null;
  name: string;
  address1: string | null;
  address2: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  verifiedAt: string | null;
  branchPricesSupported: boolean;
}
export interface ShopLocationAdminSummary {
  location: ShopLocationSummary;
  isActive: boolean;
  sourceReference: string | null;
  verifiedByAccountId: number | null;
  createdDate: string;
  updatedDate: string;
}
export interface ShopLocationAdminSearchResult {
  items: ShopLocationAdminSummary[];
  hasMore: boolean;
}
export interface ShopLocationReviewResponse {
  id: number;
  action: "Created" | "Updated" | "Retired" | "Reactivated";
  evidence: string;
  sourceReference: string;
  reviewerAccountId: number;
  reviewedAt: string;
  beforeJson: string | null;
  afterJson: string;
}
export interface ShopLocationAdminDetail {
  branch: ShopLocationAdminSummary;
  reviews: ShopLocationReviewResponse[];
}
export interface ShopLocationCreateRequest {
  details: ShopLocationDetails;
  sourceReference: string;
  evidence: string;
}
export interface ShopLocationUpdateRequest extends ShopLocationCreateRequest {
  expectedUpdatedDate: string;
}

export interface PreferredShopLocation {
  location: ShopLocationSummary;
  isAvailable: boolean;
  unavailableReason: string | null;
}
export interface ShopLocationSearchResult {
  items: ShopLocationSummary[];
  hasMore: boolean;
}

export interface BrandDiscoveryProgress {
  id: number;
  itemId: number;
  productName: string;
  shopName: string;
  status:
    | "Queued"
    | "Processing"
    | "WaitingForExtension"
    | "Completed"
    | "Failed"
    | "Cancelled";
  foundCount: number;
  errorCode: string | null;
  updatedDate: string;
  retryAfter: string | null;
}
export interface BrandDiscoveryView {
  accountId: number;
  listId: number;
  itemId: number | null;
  enabled: boolean;
  canStart: boolean;
  reason: string | null;
  jobs: BrandDiscoveryProgress[];
  queued: number;
  alreadyRunning: number;
  recent: number;
}
