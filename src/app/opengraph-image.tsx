import { ImageResponse } from "next/og";
export const alt = "MyShoppingList — private lists and saved product observations";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export default function Image() {
  return new ImageResponse(<div style={{ display: "flex", flexDirection: "column", justifyContent: "center", width: "100%", height: "100%", padding: 80, background: "#ecfdf5", color: "#0f172a" }}>
    <div style={{ display: "flex", fontSize: 30, color: "#047857", marginBottom: 30 }}>MYSHOPPINGLIST</div>
    <div style={{ display: "flex", fontSize: 70, fontWeight: 700, lineHeight: 1.1 }}>Your list. A clearer price.</div>
    <div style={{ display: "flex", fontSize: 32, lineHeight: 1.4, marginTop: 35 }}>Private shopping lists and product observations you review.</div>
    <div style={{ display: "flex", fontSize: 23, color: "#475569", marginTop: 35 }}>Saved observations · Clear timestamps · Your account</div>
  </div>, size);
}
