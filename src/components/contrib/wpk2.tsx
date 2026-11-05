"use client";
// Adds .rdk station import and export actions to the File menu.

 
 
 
 

import { importRdkStationUI, saveStationAsRdkUI } from "@/client/fileActions";
import { contributeMainMenu } from "../menuContrib";

contributeMainMenu(
  "File",
  () => [
    { label: "Import robot station (.rdk)...", onSelect: () => importRdkStationUI() },
    { label: "Export as robot station (.rdk)...", onSelect: () => void saveStationAsRdkUI() },
  ],
  5,
);
