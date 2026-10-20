import { buildDeck } from "@/lib/presentationDeck";
import { buildModelWorkbook } from "@/lib/spreadsheetModel";
import fs from "fs";
const out = process.argv[2];
(async () => {
  const deck = await buildDeck({
    title: "Acme Robotics — EMEA expansion",
    subtitle: "Account review · October 2026",
    slides: [
      { layout: "metrics", title: "Acme is ready to grow: 35 of 40 seats active after seven months", metrics: [
        { value: "88%", label: "Seats active" }, { value: "+10", label: "EMEA seats requested" },
        { value: "$62K", label: "Added ARR at current rate" }, { value: "4", label: "Calls on record" } ], source: "Anchor usage data; EMEA call, Oct 18" },
      { layout: "chart", title: "Adoption climbed every quarter since kickoff", chart: { type: "bar", categories: ["Q1","Q2","Q3","Q4"], series: [{ name: "Active seats", values: [12, 24, 31, 35] }], valueFormat: "number" }, source: "Anchor usage data" },
      { layout: "two_column", title: "One open question stands between us and signature: EU data residency", left: { heading: "What we heard", bullets: ["Priya needs EMEA call data kept in-region", "Jordan wants the 10 seats live next quarter", "Slack alerts requested by several users"] }, right: { heading: "Next steps", bullets: ["Engineering confirms EU hosting — Thu", "Send quote at existing per-seat rate — today", "Share Slack roadmap date — next call"] }, source: "EMEA expansion call, Oct 18" },
    ],
  });
  fs.writeFileSync(out + "/deck.pptx", deck);
  const x = await buildModelWorkbook({
    title: "Acme Robotics — EMEA expansion model",
    summary: "Three-year revenue from the 10-seat EMEA expansion at Acme's existing per-seat rate, with seat growth and churn assumptions.",
    sheets: [
      { name: "Assumptions", columnWidths: [34, 14], rows: [
        ["Assumption", "Value"],
        ["EMEA seats, year 1", { v: 10, input: true, fmt: "integer" }],
        ["Price per seat per year", { v: 6200, input: true, fmt: "currency" }],
        ["Annual seat growth", { v: 0.3, input: true, fmt: "percent" }],
        ["Annual churn", { v: 0.05, input: true, fmt: "percent" }],
      ]},
      { name: "Model", columnWidths: [28, 14, 14, 14], rows: [
        ["", "Year 1", "Year 2", "Year 3"],
        ["Seats", { f: "=Assumptions!B2", fmt: "integer" }, { f: "=ROUND(B2*(1+Assumptions!B4-Assumptions!B5),0)", fmt: "integer" }, { f: "=ROUND(C2*(1+Assumptions!B4-Assumptions!B5),0)", fmt: "integer" }],
        ["Price per seat", { f: "=Assumptions!B3", fmt: "currency" }, { f: "=B3", fmt: "currency" }, { f: "=C3", fmt: "currency" }],
        [{ v: "Revenue", bold: true }, { f: "=B2*B3", fmt: "currency", bold: true }, { f: "=C2*C3", fmt: "currency", bold: true }, { f: "=D2*D3", fmt: "currency", bold: true }],
        ["Cumulative revenue", { f: "=B4", fmt: "currency" }, { f: "=B5+C4", fmt: "currency" }, { f: "=C5+D4", fmt: "currency" }],
      ]},
    ],
  } as never);
  fs.writeFileSync(out + "/model.xlsx", x);
  console.log("ok");
})();
