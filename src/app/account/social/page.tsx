import SocialSignInCompletion from "@/components/social-sign-in-completion";
import { privateMetadata } from "@/lib/seo";
export const metadata = {
  ...privateMetadata,
  title: "Finish signing in | MyShoppingList",
};
export default function Page() {
  return <SocialSignInCompletion />;
}
