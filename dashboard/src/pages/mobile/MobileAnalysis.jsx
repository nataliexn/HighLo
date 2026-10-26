import React from "react";
import AnalysisView from "../AnalysisView.jsx";

// The desktop Analysis Report content already reflows to a single column
// under ~720px (see .hlo-page media query in index.css), so the mobile
// screen simply reuses it rather than duplicating the layout.
export default function MobileAnalysis() {
  return <AnalysisView />;
}
