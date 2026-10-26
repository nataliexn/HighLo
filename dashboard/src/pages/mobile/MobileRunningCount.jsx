import React from "react";
import RunningCountView from "../RunningCountView.jsx";

// Same content as the desktop expanded Running Count page; the grid and
// card-history wrap list already compact correctly at phone widths.
export default function MobileRunningCount() {
  return <RunningCountView />;
}
