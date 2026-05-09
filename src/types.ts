export type BarcodeFormat = 
  | "CODE128" 
  | "EAN13" 
  | "CODE39" 
  | "PHARMACODE"
  | "QR";

export interface BarcodeConfig {
  value: string;
  format: BarcodeFormat;
  lineColor: string;
  background: string;
  width: number;
  height: number;
  margin: number;
  displayValue: boolean;
  fontSize: number;
  font: string;
  textAlign: "left" | "center" | "right";
  textPosition: "bottom" | "top";
  textMargin: number;
}

export interface BarcodeHistoryItem {
  id: string;
  config: BarcodeConfig;
  createdAt: number;
}
