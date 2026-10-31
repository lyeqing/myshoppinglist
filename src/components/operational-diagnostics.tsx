"use client";
import { useEffect } from "react";
import { reportDiagnostic } from "@/lib/diagnostics";
export default function OperationalDiagnostics() {
  useEffect(() => {
    const failed = () => reportDiagnostic("unexpected_error");
    window.addEventListener("error", failed); window.addEventListener("unhandledrejection", failed);
    return () => { window.removeEventListener("error", failed); window.removeEventListener("unhandledrejection", failed); };
  }, []);
  return null;
}
