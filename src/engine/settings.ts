 
 
 

export const DEFAULT_SETTINGS: Record<string, number | string | boolean> = {
   
  AUTO_FIT_NEW: true,
  Dark_Theme: 0,
   
  ShowRef_NewObjects: false,
  ShowRef_NewReferences: true,
  ShowToolbarText: false,
  TexturesShow: true,
  SizePoints: 10,
  POINT_STYLE: 5,
   
  FrameSizesRef: 350,
  FrameSizesTarget: 250,
  FrameSizesPath: 150,
  FrameSizesOther: 100,
   
  TextFor_Frames: true,
  TextFor_Robots: false,
  TextFor_Objects: false,
  TextFor_Tools: true,
  TextFor_Targets: true,
  TextFor_Programs: false,
   
  ShowTextObjectOnly: false,
   
  Trace_Render_Style: 0,
   
  ViewAngle: 30,
  NearPlane: 5,
  FarPlane: 200000,
   
  ColorBgTop: "",
  ColorBgBottom: "",
   
   
  KeepRotationAligned: true,
  Mouse3D_Type: 0,
  Mouse3D_SpeedRotate: 1,
  Mouse3D_SpeedZoom: 1,
  Mouse3D_ZoomSpeed: -1,
   
  Mouse3D_ClickMid: "Rotate",
  Mouse3D_ClickRight: "Pan",
   
  MouseFeedback: true,
   
  Shortcuts: "{}",
   
  AllowTouch3D: false,
   
   
  RC_NAV_STYLE: "robocraft",
   
  MoveL_Split_MM: -1,
  MoveL_Split_MM_Min: 0.005,
  MoveL_Split_Deg: -1,
  MoveJ_Split_Deg: -1,
  MoveC_Split_Deg: 270,
  MoveC_Split_MM: -1,
  MAX_DECIMALS_POST: 6,
  MAX_DECIMALS_XYZ: 3,
  MAX_DECIMALS_WPR: 3,
  Generate_Subprogs: 2,
  Prog_InlineSubPrograms: false,
  Prog_InlineSubProgramDepth: 99,
  Hide_ProgramGen_Popup: 0,
   
  ProgMoveJType: 0,
  ProgMoveLType: 0,
  ProgMoveCType: 0,
  ProgMoveNames: 0,
  ProgRecalc: 0,
  ProgMaxLines: -1,
  ProgInlineSubprogs: 0,
   
  PathStepMM: 1,
  PathStepDeg: 1,
  PathStepCollisionMM: 4,
  PathStepCollisionDeg: 4,
  ToleranceSingularityWrist: 2.5,
  ToleranceSingularityElbow: 2.5,
  ToleranceSingularityBack: -1,
  ToleranceTurn180: 0.5,
   
   
  ToleranceSmoothMove: 25,
   
  CopyPasteKeepLinks: false,
   
  ShowHiddenSelected: true,
   
  ZoomInvert: false,
   
  RC_API_PORT: 20500,
   
  PARAM_MM_STEP_COLLISION: 4,
  PARAM_DEG_STEP_COLLISION: 4,
  Collision_Clearance: 0,
  Collision_Collide_OneStop: false,
   
  SliderIncrDeg: 10,
  SliderIncrMM: 10,
   
  UndoStackLimit: 500,
   
  AutoBackup_On: 0,
  AutoBackup_Min: 5,
   
  SimRatioNormal: 1,
  SimRatioFast: 100,
   
   
  RobotPathUpdateMS: 5,
   
   
  MoveTimeCalc: 3,
   
  PlaceAtOrigin: false,
  PlaceSpacingMM: 1000,
   
  PathWebLib: "/api/library/catalog",
  WebLibExternal2: false,
   
  RC_SHOW_LIBRARY_STATIONS: false,
   
  Default_GhostRobot_MS: 10000,
   
   
  RC_AGENT_BASE_URL: "https://api.meta.ai/v1",
  RC_AGENT_MODEL: "muse-spark-1.3",
  RC_AGENT_API: "chat_completions",
  RC_AGENT_REASONING: "default",
   
   
  RC_AGENT_WEB_SEARCH: true,
  RC_AGENT_GUARD: true,
  RC_AGENT_GUARD_MODEL: "muse-spark-1.2",
  RC_AGENT_SAM: true,
  RC_THEME: "light",
   
  RC_SHADOWS: true,
  RC_REFLECTIONS: true,
  RC_EE_VIEW: false,
   
   
  RC_PHYSICS: false,
  RC_PHYSICS_GRAVITY: 9.81,
  RC_PHYSICS_SUBSTEPS: 2,
   
  RC_MACHINING_DEFAULTS: "",
   
   
   
   
  DisplayCurves: false,
  DisplayPoints: true,
  ShowCurveNormals: false,
  DisplayCurveNormalsOnSelect: true,
  ShowCurvePoints: false,
  SizeCurvePoints: 5,
  ShowPointNormals: false,
  ShowSelectedPointNormals: true,
  SizeRatioCurves: 0.5,
  SizeNormals: 15,
  SizeCurveArrow: 30,
  TolerancePickCurve: 10,
  TolerancePickPoint: 15,
   
   
   
   
  ImportStepAction: 1,
   
   
  TreeSizePercentSet: false,
  TreeSizePercent: 20,
   
   
  TreeTextSize: 12.5,
  TreeIconSize: 15,
   
   
   
  RC_LAYOUT: "",
};

export const SETTINGS_DOC: Record<string, string> = {
  AUTO_FIT_NEW: "Fit the view after adding new items",
  RC_SHADOWS: "Soft shadows cast by a low key light onto the floor",
  RC_REFLECTIONS: "Faint blurred reflections on the floor",
  RC_EE_VIEW: "Close-up view that follows the active robot's end effector",
  RC_PHYSICS: "Rigid-body physics: released parts fall, settle, stack and are pushed by robots (off: objects stay where they are placed)",
  RC_PHYSICS_GRAVITY: "Physics gravity (m/s²)",
  RC_PHYSICS_SUBSTEPS: "Physics solver substeps per 1/60 s frame (1–16)",
  RC_MACHINING_DEFAULTS: "Machining project settings saved with Set Defaults for new projects (JSON)",
  DisplayCurves: "Display the curves of objects imported with CAD surfaces (other objects always show their curves)",
  DisplayPoints: "Display the points of objects imported with CAD surfaces (other objects always show their points)",
  ShowCurveNormals: "Display curve normals",
  DisplayCurveNormalsOnSelect: "Display curve normals on selection",
  ShowCurvePoints: "Display curve points",
  SizeCurvePoints: "Size of curve points (px)",
  ShowPointNormals: "Display point normals",
  ShowSelectedPointNormals: "Display point normals on selection",
  SizeRatioCurves: "Size of the curves (ratio; 0.5 is the default size)",
  SizeNormals: "Length of curve and point normals (mm)",
  SizeCurveArrow: "Arrow size (curve/point): tool axis arrows of curve and point follow projects (mm)",
  TolerancePickCurve: "Pick curve sensibility (mm); 0 or less turns curve picking off",
  TolerancePickPoint: "Pick point sensibility (mm); 0 or less turns point picking off",
  MoveL_Split_MM: "Split linear moves into segments of this length when generating programs (-1 = off)",
  MoveC_Split_Deg: "Split circular moves larger than this angle when generating programs",
  MAX_DECIMALS_POST: "Decimals written by post processors",
  PARAM_MM_STEP_COLLISION: "Linear step (mm) between collision checks along a path",
  PARAM_DEG_STEP_COLLISION: "Joint step (deg) between collision checks along a path",
  Collision_Clearance: "Collision clearance distance (mm)",
  SliderIncrDeg: "Robot panel joint jog increment (deg)",
  SliderIncrMM: "Robot panel Cartesian jog increment (mm)",
  UndoStackLimit: "Limit of Undo/Redo actions (0 = no limit)",
  AutoBackup_On: "Auto backup the active station when it has unsaved changes (1 = on)",
  AutoBackup_Min: "Auto backup interval (minutes)",
  ProgMaxLines: "Split generated programs after this many lines (-1 = off)",
  ProgMoveNames: "Pass target names to the post processor (1 = on)",
  ProgRecalc: "Recalculate joints of Cartesian targets before generating (1 = on)",
  PathStepMM: "Simulation step along linear paths (mm)",
  RobotPathUpdateMS: "Update robot path rate (period in ms)",
  MoveTimeCalc:
    "Move time calculation (linear vs. joint speed): 0 strictest constraint, 1 linear constrained, 2 joint constrained, 3 linear for MoveL and joint for MoveJ (default), 4 shortest time",
  ToleranceSingularityWrist: "Tolerance to avoid Wrist singularity (deg)",
  ToleranceSmoothMove: "Angle tolerance for smooth movements (deg): largest joint change between two steps of a linear path",
  CopyPasteKeepLinks: "Maintain item links with copy-paste",
  ShowHiddenSelected: "Display hidden items when selected",
  ZoomInvert: "Invert Zoom",
  ShowRef_NewObjects: "Show the reference frame of new objects",
  ShowRef_NewReferences: "Show new reference frames",
  SizePoints: "Point size (px)",
  FrameSizesRef: "Object/Tool reference size (mm)",
  FrameSizesTarget: "Target reference size (mm)",
  FrameSizesPath: "Path reference size (mm)",
  FrameSizesOther: "Other reference size (mm)",
  TextFor_Frames: "Display text for reference frames",
  TextFor_Robots: "Display text for robots",
  TextFor_Objects: "Display text for objects",
  TextFor_Tools: "Display text for tools",
  TextFor_Targets: "Display text for targets",
  TextFor_Programs: "Display text for programs",
  Trace_Render_Style: "Trace style: 0 References, 1 Line, 2 Dots, 3 Points, 4 Spheres",
  ViewAngle: "View angle (deg)",
  NearPlane: "Near plane (mm)",
  FarPlane: "Far plane (mm)",
  ColorBgTop: "Background colour, top of the gradient (#RRGGBB; empty = appearance)",
  ColorBgBottom: "Background colour, bottom of the gradient (#RRGGBB; empty = appearance)",
  KeepRotationAligned: "Keep rotation aligned (turntable around world Z)",
  Mouse3D_Type: "3D navigation type (0 = classic)",
  Mouse3D_SpeedRotate: "Rotation speed ratio",
  Mouse3D_SpeedZoom: "Zoom speed ratio",
  Mouse3D_ZoomSpeed: "Fixed zoom speed (-1 = automatic)",
  RC_NAV_STYLE: "Mouse navigation: robocraft (Enginuity style: drag items to move them, drag empty space to pan) or classic (classic style)",
  PathWebLib: "Online robot library URL",
  RC_SHOW_LIBRARY_STATIONS: "Show library example stations",
  RC_AGENT_BASE_URL: "OpenAI-compatible API base URL used by the agent (default: Meta Model API)",
  RC_AGENT_MODEL: "Model name used by the agent (default: Meta Muse Spark 1.3)",
  RC_AGENT_API: "chat_completions (any OpenAI-compatible server) or responses",
  RC_AGENT_REASONING: "Reasoning effort sent to the model: default (the model decides), minimal, low, medium, high, xhigh or max",
  RC_AGENT_WEB_SEARCH: "Let the Copilot search the web with Meta search grounding (uses the Meta Model API key)",
  RC_AGENT_GUARD: "Scope guard: a small model checks that each message is about robotics or Enginuity before the Copilot runs",
  RC_AGENT_GUARD_MODEL: "Model of the scope guard on Meta Model API",
  RC_AGENT_SAM: "Let the Copilot find objects in attached photos with SAM 3.1 (uses the Meta Model API key)",
  ImportStepAction: "Action when importing a STEP file (object vs. assembly): 0 Ask, 1 Load as one object, 2 Load as assembly",
  TreeSizePercentSet: "Set tree size as a % of the screen",
  TreeSizePercent: "Tree size (% of the screen) when 'Set tree size as a % of the screen' is on",
  TreeTextSize: "Text size (tree), px",
  TreeIconSize: "Icon size (tree), px",
  RC_LAYOUT: "Saved window layout (JSON: toolbar layout, tree placement, right-hand panel); empty = default",
};
