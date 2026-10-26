import React from "react";
import { NavLink } from "react-router-dom";

export default function MobileTabBar() {
  return (
    <div className="hlo-tabbar">
      <NavLink to="/hand" className={({ isActive }) => `hlo-tabbar__item ${isActive ? "active" : ""}`}>
        Current Hand
      </NavLink>
      <NavLink to="/analysis" className={({ isActive }) => `hlo-tabbar__item ${isActive ? "active" : ""}`}>
        Analysis
      </NavLink>
      <NavLink to="/count" className={({ isActive }) => `hlo-tabbar__item ${isActive ? "active" : ""}`}>
        Running Count
      </NavLink>
    </div>
  );
}
