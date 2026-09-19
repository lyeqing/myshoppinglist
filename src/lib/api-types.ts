export type JobState = "Queued" | "Processing" | "Completed" | "Partial" | "Failed" | "Cancelled";
export type RetailerState = "Pending" | "Checking" | "Exact" | "Likely" | "Possible" | "NotFound" | "Unavailable" | "CheckFailed" | "NotSupported";
export interface Session { account: { id: number; displayName: string; isTrial: boolean; expiresDate: string | null }; shoppingListId: number | null; sessionExpiresDate: string }
export interface Accepted { jobId: number; status: JobState; quantity: number; reused: boolean; statusUrl: string }
export interface ImportPage { items: { jobId: number; status: JobState; createdDate: string }[]; nextBeforeId: number | null }
export interface Price { price: number; normalPrice: number | null; unitPrice: number | null; currency: string; shopLocationId: number | null; priceScope: string; sourceType: string; sourceUrl: string; checkedDate: string; inStock: boolean | null; specialType: string | null; specialDescription: string | null; specialStartDate: string | null; specialEndDate: string | null }
export interface Retailer { shopId: number; shopName: string; status: RetailerState; matchType: string | null; matchConfidence: number | null; isFromCache: boolean; checkedDate: string | null; errorCode: string | null; prices: Price[] }
export interface Job { jobId: number; shoppingListId: number; status: JobState; progressStage: string; quantity: number; shoppingListProductId: number | null; product: { id: number; name: string; brand: string | null; variant: string | null; packQuantity: number | null; packSize: number | null; packUnit: string | null; imageUrl: string | null } | null; createdDate: string; lastActivityDate: string | null; completedDate: string | null; nextAttemptDate: string | null; errorCode: string | null; retailers: Retailer[] }
export function isActive(job: Job) { return job.status === "Queued" || job.status === "Processing"; }
export function placeholder(jobId: number, listId: number, quantity = 1): Job {
  return { jobId, shoppingListId: listId, quantity, status: "Queued", progressStage: "Queued", product: null, shoppingListProductId: null, createdDate: new Date().toISOString(), lastActivityDate: null, completedDate: null, nextAttemptDate: null, errorCode: null, retailers: [] };
}
