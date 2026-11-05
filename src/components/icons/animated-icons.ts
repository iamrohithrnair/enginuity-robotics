 
 
// (@animateicons/react, MIT, Copyright (c) 2025 Avijit Dey) and lucide-animated (./animated, MIT,
// Copyright (c) 2024-2026 pqoqubbw) animate Lucide artwork (ISC); see THIRD_PARTY_NOTICES.md.
// Maps studio icon names to animated React icon components.
import type { CSSProperties, ComponentType, Ref } from "react";
import { ActivityIcon } from "@animateicons/react/lucide/activity-icon";
import { BlendIcon } from "@animateicons/react/lucide/blend-icon";
import { BlocksIcon } from "@animateicons/react/lucide/blocks-icon";
import { BoxIcon } from "@animateicons/react/lucide/box-icon";
import { CameraIcon } from "@animateicons/react/lucide/camera-icon";
import { CheckIcon } from "@animateicons/react/lucide/check-icon";
import { ChevronDownIcon } from "@animateicons/react/lucide/chevron-down-icon";
import { ChevronRightIcon } from "@animateicons/react/lucide/chevron-right-icon";
import { CircleQuestionMarkIcon } from "@animateicons/react/lucide/circle-question-mark-icon";
import { CircleStopIcon } from "@animateicons/react/lucide/circle-stop-icon";
import { ClipboardPasteIcon } from "@animateicons/react/lucide/clipboard-paste-icon";
import { CodeXmlIcon } from "@animateicons/react/lucide/code-xml-icon";
import { CommandIcon } from "@animateicons/react/lucide/command-icon";
import { CopyIcon } from "@animateicons/react/lucide/copy-icon";
import { CornerDownRightIcon } from "@animateicons/react/lucide/corner-down-right-icon";
import { DownloadIcon } from "@animateicons/react/lucide/download-icon";
import { ExpandIcon } from "@animateicons/react/lucide/expand-icon";
import { ExternalLinkIcon } from "@animateicons/react/lucide/external-link-icon";
import { EyeIcon } from "@animateicons/react/lucide/eye-icon";
import { EyeOffIcon } from "@animateicons/react/lucide/eye-off-icon";
import { FastForwardIcon } from "@animateicons/react/lucide/fast-forward-icon";
import { FileCodeIcon } from "@animateicons/react/lucide/file-code-icon";
import { FilePlusIcon } from "@animateicons/react/lucide/file-plus-icon";
import { FileTerminalIcon } from "@animateicons/react/lucide/file-terminal-icon";
import { FolderIcon } from "@animateicons/react/lucide/folder-icon";
import { FolderOpenIcon } from "@animateicons/react/lucide/folder-open-icon";
import { GaugeIcon } from "@animateicons/react/lucide/gauge-icon";
import { HandIcon } from "@animateicons/react/lucide/hand-icon";
import { HouseIcon } from "@animateicons/react/lucide/house-icon";
import { InfoIcon } from "@animateicons/react/lucide/info-icon";
import { LayersIcon } from "@animateicons/react/lucide/layers-icon";
import { MessageSquareIcon } from "@animateicons/react/lucide/message-square-icon";
import { MessageSquareTextIcon } from "@animateicons/react/lucide/message-square-text-icon";
import { MinusIcon } from "@animateicons/react/lucide/minus-icon";
import { MousePointerIcon } from "@animateicons/react/lucide/mouse-pointer-icon";
import { MoveIcon } from "@animateicons/react/lucide/move-icon";
import { PackageIcon } from "@animateicons/react/lucide/package-icon";
import { PaletteIcon } from "@animateicons/react/lucide/palette-icon";
import { PauseIcon } from "@animateicons/react/lucide/pause-icon";
import { PlayIcon } from "@animateicons/react/lucide/play-icon";
import { PlusIcon } from "@animateicons/react/lucide/plus-icon";
import { PrinterIcon } from "@animateicons/react/lucide/printer-icon";
import { RedoIcon } from "@animateicons/react/lucide/redo-icon";
import { RepeatIcon } from "@animateicons/react/lucide/repeat-icon";
import { RotateCwIcon } from "@animateicons/react/lucide/rotate-cw-icon";
import { RouteIcon } from "@animateicons/react/lucide/route-icon";
import { RulerIcon } from "@animateicons/react/lucide/ruler-icon";
import { SaveIcon } from "@animateicons/react/lucide/save-icon";
import { ScanIcon } from "@animateicons/react/lucide/scan-icon";
import { ScissorsIcon } from "@animateicons/react/lucide/scissors-icon";
import { ScrollTextIcon } from "@animateicons/react/lucide/scroll-text-icon";
import { SearchIcon } from "@animateicons/react/lucide/search-icon";
import { SendIcon } from "@animateicons/react/lucide/send-icon";
import { SettingsIcon } from "@animateicons/react/lucide/settings-icon";
import { SignpostIcon } from "@animateicons/react/lucide/signpost-icon";
import { SparklesIcon } from "@animateicons/react/lucide/sparkles-icon";
import { StickyNoteIcon } from "@animateicons/react/lucide/sticky-note-icon";
import { TargetIcon } from "@animateicons/react/lucide/target-icon";
import { ToggleRightIcon } from "@animateicons/react/lucide/toggle-right-icon";
import { Trash2Icon } from "@animateicons/react/lucide/trash-2-icon";
import { TriangleAlertIcon } from "@animateicons/react/lucide/triangle-alert-icon";
import { UndoIcon } from "@animateicons/react/lucide/undo-icon";
import { XIcon } from "@animateicons/react/lucide/x-icon";
import { ZapIcon } from "@animateicons/react/lucide/zap-icon";
import { ZoomInIcon } from "@animateicons/react/lucide/zoom-in-icon";
import { CctvIcon } from "./animated/cctv";
import { HandGrabIcon } from "./animated/hand-grab";
import { MapPinPlusIcon } from "./animated/map-pin-plus";

export interface AnimatedHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}
export type AnimatedComponent = ComponentType<{ size?: number; className?: string; style?: CSSProperties; "aria-hidden"?: boolean; ref?: Ref<AnimatedHandle> }>;

export const ANIMATED_ICONS = {
  "lucide/activity": ActivityIcon,
  "lucide/blend": BlendIcon,
  "lucide/blocks": BlocksIcon,
  "lucide/box": BoxIcon,
  "lucide/camera": CameraIcon,
  "lucide/check": CheckIcon,
  "lucide/chevron-down": ChevronDownIcon,
  "lucide/chevron-right": ChevronRightIcon,
  "lucide/circle-question-mark": CircleQuestionMarkIcon,
  "lucide/circle-stop": CircleStopIcon,
  "lucide/clipboard-paste": ClipboardPasteIcon,
  "lucide/code-xml": CodeXmlIcon,
  "lucide/command": CommandIcon,
  "lucide/copy": CopyIcon,
  "lucide/corner-down-right": CornerDownRightIcon,
  "lucide/download": DownloadIcon,
  "lucide/expand": ExpandIcon,
  "lucide/external-link": ExternalLinkIcon,
  "lucide/eye": EyeIcon,
  "lucide/eye-off": EyeOffIcon,
  "lucide/fast-forward": FastForwardIcon,
  "lucide/file-code": FileCodeIcon,
  "lucide/file-plus": FilePlusIcon,
  "lucide/file-terminal": FileTerminalIcon,
  "lucide/folder": FolderIcon,
  "lucide/folder-open": FolderOpenIcon,
  "lucide/gauge": GaugeIcon,
  "lucide/hand": HandIcon,
  "lucide/house": HouseIcon,
  "lucide/info": InfoIcon,
  "lucide/layers": LayersIcon,
  "lucide/message-square": MessageSquareIcon,
  "lucide/message-square-text": MessageSquareTextIcon,
  "lucide/minus": MinusIcon,
  "lucide/mouse-pointer": MousePointerIcon,
  "lucide/move": MoveIcon,
  "lucide/package": PackageIcon,
  "lucide/palette": PaletteIcon,
  "lucide/pause": PauseIcon,
  "lucide/play": PlayIcon,
  "lucide/plus": PlusIcon,
  "lucide/printer": PrinterIcon,
  "lucide/redo": RedoIcon,
  "lucide/repeat": RepeatIcon,
  "lucide/rotate-cw": RotateCwIcon,
  "lucide/route": RouteIcon,
  "lucide/ruler": RulerIcon,
  "lucide/save": SaveIcon,
  "lucide/scan": ScanIcon,
  "lucide/scissors": ScissorsIcon,
  "lucide/scroll-text": ScrollTextIcon,
  "lucide/search": SearchIcon,
  "lucide/send": SendIcon,
  "lucide/settings": SettingsIcon,
  "lucide/signpost": SignpostIcon,
  "lucide/sparkles": SparklesIcon,
  "lucide/sticky-note": StickyNoteIcon,
  "lucide/target": TargetIcon,
  "lucide/toggle-right": ToggleRightIcon,
  "lucide/trash-2": Trash2Icon,
  "lucide/triangle-alert": TriangleAlertIcon,
  "lucide/undo": UndoIcon,
  "lucide/x": XIcon,
  "lucide/zap": ZapIcon,
  "lucide/zoom-in": ZoomInIcon,
  "lucide-animated/cctv": CctvIcon,
  "lucide-animated/hand-grab": HandGrabIcon,
  "lucide-animated/map-pin-plus": MapPinPlusIcon,
} satisfies Record<string, AnimatedComponent>;

export type AnimatedIconId = keyof typeof ANIMATED_ICONS;
