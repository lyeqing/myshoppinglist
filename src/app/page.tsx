import ShoppingListApp from "@/components/shopping-list-app";
import ShoppingStoreProvider from "@/components/shopping-store-provider";
export default function Page() { return <ShoppingStoreProvider><ShoppingListApp /></ShoppingStoreProvider>; }
