// Colmena's icons: Phosphor (MIT; @phosphor-icons/react, pinned) behind one adapter (PRODUCT.md ›
// Brand Commitments; docs/SCREENS.md › v4). Never draw an icon by hand.
//
//   import { Search, House } from "../Icon.js";
//   <Search size={ICON.sm} />               regular weight, the default
//   <House size={ICON.md} active={on} />    filled: the active place, a selected tab, a toggled control
//
// Names are semantic: the ones the screens already used (Lucide's, so the move kept every call
// site), plus a few for what used to be hand-drawn (House, Books, Gear…). Each line below maps a
// name to its Phosphor glyph; «≈» marks the ones without a direct twin.
//
// Props: size in px (default 24; the scale is ICON 16 · 20 · 24), active (→ weight "fill"),
// weight ("regular" | "bold" | "fill"; thin, light and duotone draw as regular), strokeWidth (read
// as Lucide's was: 2.4 or more draws bold), color (currentColor) and any SVG attribute. Bold is
// the regular outline traced a little heavier, so only two weights ship. Icons are decorative
// (aria-hidden) unless they get an aria-label or a title: the button or link around one carries
// the name.
//
// Adding an icon: add an export here with icon(G.<PhosphorName>, …) and run
// `node scripts/gen-icons.mjs`: it copies that glyph's regular and fill paths from the pinned
// @phosphor-icons/react into icons.gen.js (static member access on the namespace below keeps the
// bundle to the glyphs in use).
import { createElement, forwardRef } from "react";
import * as G from "./icons.gen.js";

/** The size scale: 16 in dense rows and chips, 20 for places and toolbars, 24 for heroes. */
export const ICON = Object.freeze({ sm: 16, md: 20, lg: 24 });

/** The weight a set of props asks for: "regular" | "bold" | "fill". */
export function weightOf({ weight, active, strokeWidth } = {}) {
  if (weight === "fill" || (!weight && active)) return "fill";
  if (weight === "bold" || (!weight && Number(strokeWidth) >= 2.4)) return "bold";
  return "regular";
}

const draw = (shape, k) => (typeof shape === "string" ? createElement("path", { key: k, d: shape }) : shape.map(([tag, attrs], i) => createElement(tag, { key: k + i, ...attrs })));

function icon(glyph, name, mirrored = false) {
  const Icon = forwardRef(function Icon({ size = 24, active = false, weight, strokeWidth, absoluteStrokeWidth: _abs, color = "currentColor", style, ...rest }, ref) {
    const w = weightOf({ weight, active, strokeWidth });
    const named = rest["aria-label"] || rest.title || rest["aria-labelledby"];
    const bold = w === "bold" ? { stroke: color, strokeWidth: 7, strokeLinejoin: "round", strokeLinecap: "round" } : null;
    return createElement("svg", {
      ref, xmlns: "http://www.w3.org/2000/svg", width: size, height: size, viewBox: "0 0 256 256", fill: color,
      "aria-hidden": named ? undefined : "true", focusable: "false", "data-icon": name,
      style: mirrored ? { transform: "scaleX(-1)", ...style } : style, ...bold, ...rest,
    }, draw(glyph[w === "fill" ? 1 : 0], "g"));
  });
  Icon.displayName = name;
  return Icon;
}

export const Activity = /* @__PURE__ */ icon(G.Pulse, "Activity");
export const AddressBook = /* @__PURE__ */ icon(G.AddressBook, "AddressBook");
export const AlarmClock = /* @__PURE__ */ icon(G.Alarm, "AlarmClock");
export const AppWindow = /* @__PURE__ */ icon(G.AppWindow, "AppWindow");
export const Archive = /* @__PURE__ */ icon(G.Archive, "Archive");
export const ArchiveRestore = /* @__PURE__ */ icon(G.ArrowUUpLeft, "ArchiveRestore"); // â‰ˆ no archive-restore: the undo arrow
export const ArrowDown = /* @__PURE__ */ icon(G.ArrowDown, "ArrowDown");
export const ArrowDownRight = /* @__PURE__ */ icon(G.ArrowDownRight, "ArrowDownRight");
export const ArrowFatUp = /* @__PURE__ */ icon(G.ArrowFatUp, "ArrowFatUp");
export const ArrowLeft = /* @__PURE__ */ icon(G.ArrowLeft, "ArrowLeft");
export const ArrowLeftRight = /* @__PURE__ */ icon(G.ArrowsLeftRight, "ArrowLeftRight");
export const ArrowLeftToLine = /* @__PURE__ */ icon(G.ArrowLineLeft, "ArrowLeftToLine");
export const ArrowRight = /* @__PURE__ */ icon(G.ArrowRight, "ArrowRight");
export const ArrowRightToLine = /* @__PURE__ */ icon(G.ArrowLineRight, "ArrowRightToLine");
export const ArrowUp = /* @__PURE__ */ icon(G.ArrowUp, "ArrowUp");
export const ArrowUpRight = /* @__PURE__ */ icon(G.ArrowUpRight, "ArrowUpRight");
export const ArrowsClockwise = /* @__PURE__ */ icon(G.ArrowsClockwise, "ArrowsClockwise");
export const At = /* @__PURE__ */ icon(G.At, "At");
export const AudioLines = /* @__PURE__ */ icon(G.Waveform, "AudioLines");
export const Ban = /* @__PURE__ */ icon(G.Prohibit, "Ban");
export const Banknote = /* @__PURE__ */ icon(G.Money, "Banknote");
export const Bell = /* @__PURE__ */ icon(G.Bell, "Bell");
export const BellRing = /* @__PURE__ */ icon(G.BellRinging, "BellRing");
export const BellSlash = /* @__PURE__ */ icon(G.BellSlash, "BellSlash");
export const Bookmark = /* @__PURE__ */ icon(G.BookmarkSimple, "Bookmark");
export const Books = /* @__PURE__ */ icon(G.Books, "Books");
export const Bot = /* @__PURE__ */ icon(G.Robot, "Bot");
export const Brain = /* @__PURE__ */ icon(G.Brain, "Brain");
export const Calendar = /* @__PURE__ */ icon(G.CalendarBlank, "Calendar");
export const CalendarCheck = /* @__PURE__ */ icon(G.CalendarCheck, "CalendarCheck");
export const CalendarClock = /* @__PURE__ */ icon(G.CalendarDots, "CalendarClock"); // â‰ˆ calendar with days
export const Camera = /* @__PURE__ */ icon(G.Camera, "Camera");
export const CaretDoubleRight = /* @__PURE__ */ icon(G.CaretDoubleRight, "CaretDoubleRight");
export const ChartBar = /* @__PURE__ */ icon(G.ChartBar, "ChartBar");
export const ChartColumn = /* @__PURE__ */ icon(G.ChartBar, "ChartColumn");
export const ChatCircleText = /* @__PURE__ */ icon(G.ChatCircleText, "ChatCircleText");
export const Check = /* @__PURE__ */ icon(G.Check, "Check");
export const CheckSquare = /* @__PURE__ */ icon(G.CheckSquare, "CheckSquare");
export const ChevronDown = /* @__PURE__ */ icon(G.CaretDown, "ChevronDown");
export const ChevronLeft = /* @__PURE__ */ icon(G.CaretLeft, "ChevronLeft");
export const ChevronRight = /* @__PURE__ */ icon(G.CaretRight, "ChevronRight");
export const ChevronUp = /* @__PURE__ */ icon(G.CaretUp, "ChevronUp");
export const ChevronsUpDown = /* @__PURE__ */ icon(G.CaretUpDown, "ChevronsUpDown");
export const Circle = /* @__PURE__ */ icon(G.Circle, "Circle");
export const CircleAlert = /* @__PURE__ */ icon(G.WarningCircle, "CircleAlert");
export const CircleCheck = /* @__PURE__ */ icon(G.CheckCircle, "CircleCheck");
export const CircleHelp = /* @__PURE__ */ icon(G.Question, "CircleHelp");
export const CirclePause = /* @__PURE__ */ icon(G.PauseCircle, "CirclePause");
export const CircleX = /* @__PURE__ */ icon(G.XCircle, "CircleX");
export const Clipboard = /* @__PURE__ */ icon(G.Clipboard, "Clipboard");
export const ClipboardCopy = /* @__PURE__ */ icon(G.Clipboard, "ClipboardCopy");
export const ClipboardPaste = /* @__PURE__ */ icon(G.ClipboardText, "ClipboardPaste");
export const ClipboardType = /* @__PURE__ */ icon(G.ClipboardText, "ClipboardType");
export const Clock = /* @__PURE__ */ icon(G.Clock, "Clock");
export const Clock3 = /* @__PURE__ */ icon(G.Clock, "Clock3");
export const Cloud = /* @__PURE__ */ icon(G.Cloud, "Cloud");
export const Code = /* @__PURE__ */ icon(G.Code, "Code");
export const CodeXml = /* @__PURE__ */ icon(G.Code, "CodeXml");
export const Columns2 = /* @__PURE__ */ icon(G.Columns, "Columns2");
export const Columns3 = /* @__PURE__ */ icon(G.Columns, "Columns3"); // â‰ˆ two columns
export const Command = /* @__PURE__ */ icon(G.Command, "Command");
export const Compass = /* @__PURE__ */ icon(G.Compass, "Compass");
export const Copy = /* @__PURE__ */ icon(G.Copy, "Copy");
export const CopyPlus = /* @__PURE__ */ icon(G.CopySimple, "CopyPlus"); // â‰ˆ no copy-plus
export const CornerDownLeft = /* @__PURE__ */ icon(G.ArrowElbowDownLeft, "CornerDownLeft");
export const CornerDownRight = /* @__PURE__ */ icon(G.ArrowElbowDownRight, "CornerDownRight");
export const Cpu = /* @__PURE__ */ icon(G.Cpu, "Cpu");
export const Crop = /* @__PURE__ */ icon(G.Crop, "Crop");
export const Cursor = /* @__PURE__ */ icon(G.Cursor, "Cursor");
export const CursorClick = /* @__PURE__ */ icon(G.CursorClick, "CursorClick");
export const DoorOpen = /* @__PURE__ */ icon(G.DoorOpen, "DoorOpen");
export const DotsThreeVertical = /* @__PURE__ */ icon(G.DotsThreeVertical, "DotsThreeVertical");
export const Download = /* @__PURE__ */ icon(G.DownloadSimple, "Download");
export const Ellipsis = /* @__PURE__ */ icon(G.DotsThree, "Ellipsis");
export const Eraser = /* @__PURE__ */ icon(G.Eraser, "Eraser");
export const Expand = /* @__PURE__ */ icon(G.ArrowsOutSimple, "Expand");
export const ExternalLink = /* @__PURE__ */ icon(G.ArrowSquareOut, "ExternalLink");
export const Eye = /* @__PURE__ */ icon(G.Eye, "Eye");
export const EyeOff = /* @__PURE__ */ icon(G.EyeSlash, "EyeOff");
export const File = /* @__PURE__ */ icon(G.File, "File");
export const FileCode2 = /* @__PURE__ */ icon(G.FileCode, "FileCode2");
export const FileDiff = /* @__PURE__ */ icon(G.GitDiff, "FileDiff"); // â‰ˆ diff
export const FileDown = /* @__PURE__ */ icon(G.FileArrowDown, "FileDown");
export const FileImage = /* @__PURE__ */ icon(G.FileImage, "FileImage");
export const FileJson = /* @__PURE__ */ icon(G.BracketsCurly, "FileJson"); // â‰ˆ braces
export const FilePen = /* @__PURE__ */ icon(G.NotePencil, "FilePen"); // â‰ˆ note with pencil
export const FilePlus2 = /* @__PURE__ */ icon(G.FilePlus, "FilePlus2");
export const FileSpreadsheet = /* @__PURE__ */ icon(G.FileXls, "FileSpreadsheet");
export const FileText = /* @__PURE__ */ icon(G.FileText, "FileText");
export const FileX2 = /* @__PURE__ */ icon(G.FileX, "FileX2");
export const Files = /* @__PURE__ */ icon(G.Files, "Files");
export const Flag = /* @__PURE__ */ icon(G.Flag, "Flag");
export const Folder = /* @__PURE__ */ icon(G.Folder, "Folder");
export const FolderCheck = /* @__PURE__ */ icon(G.FolderSimpleStar, "FolderCheck"); // â‰ˆ marked folder
export const FolderCode = /* @__PURE__ */ icon(G.FolderSimple, "FolderCode"); // â‰ˆ plain folder
export const FolderOpen = /* @__PURE__ */ icon(G.FolderOpen, "FolderOpen");
export const Funnel = /* @__PURE__ */ icon(G.Funnel, "Funnel");
export const Gear = /* @__PURE__ */ icon(G.GearSix, "Gear");
export const GitBranch = /* @__PURE__ */ icon(G.GitBranch, "GitBranch");
export const GitMerge = /* @__PURE__ */ icon(G.GitMerge, "GitMerge");
export const GitPullRequest = /* @__PURE__ */ icon(G.GitPullRequest, "GitPullRequest");
export const GitPullRequestArrow = /* @__PURE__ */ icon(G.GitPullRequest, "GitPullRequestArrow");
export const Globe = /* @__PURE__ */ icon(G.Globe, "Globe");
export const GraduationCap = /* @__PURE__ */ icon(G.GraduationCap, "GraduationCap");
export const GripVertical = /* @__PURE__ */ icon(G.DotsSixVertical, "GripVertical");
export const Handshake = /* @__PURE__ */ icon(G.Handshake, "Handshake");
export const Hash = /* @__PURE__ */ icon(G.Hash, "Hash");
export const Hexagon = /* @__PURE__ */ icon(G.Hexagon, "Hexagon");
export const History = /* @__PURE__ */ icon(G.ClockCounterClockwise, "History");
export const Hourglass = /* @__PURE__ */ icon(G.Hourglass, "Hourglass");
export const House = /* @__PURE__ */ icon(G.House, "House");
export const Image = /* @__PURE__ */ icon(G.Image, "Image");
export const ImagePlus = /* @__PURE__ */ icon(G.ImageSquare, "ImagePlus"); // â‰ˆ no image-plus
export const Inbox = /* @__PURE__ */ icon(G.Tray, "Inbox");
export const KeyRound = /* @__PURE__ */ icon(G.Key, "KeyRound");
export const Keyboard = /* @__PURE__ */ icon(G.Keyboard, "Keyboard");
export const Laptop = /* @__PURE__ */ icon(G.Laptop, "Laptop");
export const LayoutGrid = /* @__PURE__ */ icon(G.SquaresFour, "LayoutGrid");
export const Lightbulb = /* @__PURE__ */ icon(G.Lightbulb, "Lightbulb");
export const Lightning = /* @__PURE__ */ icon(G.Lightning, "Lightning");
export const ListBullets = /* @__PURE__ */ icon(G.ListBullets, "ListBullets");
export const ListChecks = /* @__PURE__ */ icon(G.ListChecks, "ListChecks");
export const ListOrdered = /* @__PURE__ */ icon(G.ListNumbers, "ListOrdered");
export const LoaderCircle = /* @__PURE__ */ icon(G.CircleNotch, "LoaderCircle");
export const Lock = /* @__PURE__ */ icon(G.Lock, "Lock");
export const LockKeyhole = /* @__PURE__ */ icon(G.LockKey, "LockKeyhole");
export const LockOpen = /* @__PURE__ */ icon(G.LockOpen, "LockOpen");
export const LogOut = /* @__PURE__ */ icon(G.SignOut, "LogOut");
export const Mail = /* @__PURE__ */ icon(G.Envelope, "Mail");
export const Maximize2 = /* @__PURE__ */ icon(G.ArrowsOut, "Maximize2");
export const MessageCircle = /* @__PURE__ */ icon(G.ChatCircle, "MessageCircle");
export const MessageCircleQuestion = /* @__PURE__ */ icon(G.ChatCircleDots, "MessageCircleQuestion"); // â‰ˆ chat with dots
export const MessageSquare = /* @__PURE__ */ icon(G.ChatCenteredText, "MessageSquare");
export const MessageSquarePlus = /* @__PURE__ */ icon(G.ChatCenteredDots, "MessageSquarePlus"); // â‰ˆ no chat-plus
export const MessageSquareReply = /* @__PURE__ */ icon(G.ArrowBendUpLeft, "MessageSquareReply"); // â‰ˆ the reply arrow
export const MessageSquareText = /* @__PURE__ */ icon(G.ChatText, "MessageSquareText");
export const MessagesSquare = /* @__PURE__ */ icon(G.Chats, "MessagesSquare");
export const Mic = /* @__PURE__ */ icon(G.Microphone, "Mic");
export const MicOff = /* @__PURE__ */ icon(G.MicrophoneSlash, "MicOff");
export const Microphone = /* @__PURE__ */ icon(G.Microphone, "Microphone");
export const Minimize2 = /* @__PURE__ */ icon(G.ArrowsIn, "Minimize2");
export const Minus = /* @__PURE__ */ icon(G.Minus, "Minus");
export const Monitor = /* @__PURE__ */ icon(G.Monitor, "Monitor");
export const MonitorSmartphone = /* @__PURE__ */ icon(G.Devices, "MonitorSmartphone");
export const Moon = /* @__PURE__ */ icon(G.Moon, "Moon");
export const Network = /* @__PURE__ */ icon(G.TreeStructure, "Network");
export const Note = /* @__PURE__ */ icon(G.Note, "Note");
export const NotePencil = /* @__PURE__ */ icon(G.NotePencil, "NotePencil");
export const NotebookText = /* @__PURE__ */ icon(G.Notebook, "NotebookText");
export const PackagePlus = /* @__PURE__ */ icon(G.Package, "PackagePlus"); // â‰ˆ package
export const PanelRight = /* @__PURE__ */ icon(G.SidebarSimple, "PanelRight", true);
export const PanelRightClose = /* @__PURE__ */ icon(G.SidebarSimple, "PanelRightClose", true);
export const Paperclip = /* @__PURE__ */ icon(G.Paperclip, "Paperclip");
export const Path = /* @__PURE__ */ icon(G.Path, "Path");
export const Pause = /* @__PURE__ */ icon(G.Pause, "Pause");
export const PenLine = /* @__PURE__ */ icon(G.PencilLine, "PenLine");
export const Pencil = /* @__PURE__ */ icon(G.PencilSimple, "Pencil");
export const PencilLine = /* @__PURE__ */ icon(G.PencilLine, "PencilLine");
export const PhoneOff = /* @__PURE__ */ icon(G.PhoneSlash, "PhoneOff");
// Colmena 4's room (design/v4/colmena-v4.html): sending, the honey pill, read ticks, a document, a private room.
export const PaperPlaneRight = /* @__PURE__ */ icon(G.PaperPlaneRight, "PaperPlaneRight");
export const HandPointing = /* @__PURE__ */ icon(G.HandPointing, "HandPointing");
export const Checks = /* @__PURE__ */ icon(G.Checks, "Checks");
export const FileDoc = /* @__PURE__ */ icon(G.FileDoc, "FileDoc");
export const LockSimple = /* @__PURE__ */ icon(G.LockSimple, "LockSimple");
export const Desktop = /* @__PURE__ */ icon(G.Desktop, "Desktop");
export const Smiley = /* @__PURE__ */ icon(G.Smiley, "Smiley");
export const Pin = /* @__PURE__ */ icon(G.PushPin, "Pin");
export const PinOff = /* @__PURE__ */ icon(G.PushPinSlash, "PinOff");
export const Planet = /* @__PURE__ */ icon(G.Planet, "Planet");
export const Play = /* @__PURE__ */ icon(G.Play, "Play");
export const Plug = /* @__PURE__ */ icon(G.Plug, "Plug");
export const Plus = /* @__PURE__ */ icon(G.Plus, "Plus");
export const Power = /* @__PURE__ */ icon(G.Power, "Power");
export const Presentation = /* @__PURE__ */ icon(G.PresentationChart, "Presentation");
export const Question = /* @__PURE__ */ icon(G.Question, "Question");
export const Quote = /* @__PURE__ */ icon(G.Quotes, "Quote");
export const RefreshCw = /* @__PURE__ */ icon(G.ArrowsClockwise, "RefreshCw");
export const Repeat = /* @__PURE__ */ icon(G.Repeat, "Repeat");
export const Robot = /* @__PURE__ */ icon(G.Robot, "Robot");
export const RotateCcw = /* @__PURE__ */ icon(G.ArrowCounterClockwise, "RotateCcw");
export const RotateCw = /* @__PURE__ */ icon(G.ArrowClockwise, "RotateCw");
export const Rows3 = /* @__PURE__ */ icon(G.Rows, "Rows3");
export const Save = /* @__PURE__ */ icon(G.FloppyDisk, "Save");
export const Scissors = /* @__PURE__ */ icon(G.Scissors, "Scissors");
export const Search = /* @__PURE__ */ icon(G.MagnifyingGlass, "Search");
export const Send = /* @__PURE__ */ icon(G.PaperPlaneTilt, "Send");
export const Server = /* @__PURE__ */ icon(G.HardDrives, "Server");
export const Settings2 = /* @__PURE__ */ icon(G.SlidersHorizontal, "Settings2");
export const Shield = /* @__PURE__ */ icon(G.Shield, "Shield");
export const ShieldAlert = /* @__PURE__ */ icon(G.ShieldWarning, "ShieldAlert");
export const ShieldCheck = /* @__PURE__ */ icon(G.ShieldCheck, "ShieldCheck");
export const Sidebar = /* @__PURE__ */ icon(G.SidebarSimple, "Sidebar");
export const Sigma = /* @__PURE__ */ icon(G.Sigma, "Sigma");
export const Sliders = /* @__PURE__ */ icon(G.SlidersHorizontal, "Sliders");
export const SmilePlus = /* @__PURE__ */ icon(G.Smiley, "SmilePlus"); // â‰ˆ no smiley-plus
export const Sparkles = /* @__PURE__ */ icon(G.Sparkle, "Sparkles");
export const SpeakerHigh = /* @__PURE__ */ icon(G.SpeakerHigh, "SpeakerHigh");
export const Square = /* @__PURE__ */ icon(G.Square, "Square");
export const SquareArrowOutUpRight = /* @__PURE__ */ icon(G.ArrowSquareOut, "SquareArrowOutUpRight");
export const SquareSlash = /* @__PURE__ */ icon(G.Prohibit, "SquareSlash"); // â‰ˆ prohibit
export const SquareTerminal = /* @__PURE__ */ icon(G.TerminalWindow, "SquareTerminal");
export const Stethoscope = /* @__PURE__ */ icon(G.Stethoscope, "Stethoscope");
export const Stop = /* @__PURE__ */ icon(G.Stop, "Stop");
export const Sun = /* @__PURE__ */ icon(G.Sun, "Sun");
export const Table = /* @__PURE__ */ icon(G.Table, "Table");
export const Target = /* @__PURE__ */ icon(G.Target, "Target");
export const TerminalWindow = /* @__PURE__ */ icon(G.TerminalWindow, "TerminalWindow");
export const TextCursorInput = /* @__PURE__ */ icon(G.Textbox, "TextCursorInput");
export const TextSelect = /* @__PURE__ */ icon(G.Selection, "TextSelect"); // â‰ˆ selection
export const ThumbsDown = /* @__PURE__ */ icon(G.ThumbsDown, "ThumbsDown");
export const ThumbsUp = /* @__PURE__ */ icon(G.ThumbsUp, "ThumbsUp");
export const Ticket = /* @__PURE__ */ icon(G.Ticket, "Ticket");
export const Trash2 = /* @__PURE__ */ icon(G.Trash, "Trash2");
export const TrendingDown = /* @__PURE__ */ icon(G.TrendDown, "TrendingDown");
export const TrendingUp = /* @__PURE__ */ icon(G.TrendUp, "TrendingUp");
export const TriangleAlert = /* @__PURE__ */ icon(G.Warning, "TriangleAlert");
export const Type = /* @__PURE__ */ icon(G.TextT, "Type");
export const Undo2 = /* @__PURE__ */ icon(G.ArrowUUpLeft, "Undo2");
export const Upload = /* @__PURE__ */ icon(G.UploadSimple, "Upload");
export const UploadCloud = /* @__PURE__ */ icon(G.CloudArrowUp, "UploadCloud");
export const UserMinus = /* @__PURE__ */ icon(G.UserMinus, "UserMinus");
export const UserPlus = /* @__PURE__ */ icon(G.UserPlus, "UserPlus");
export const UserRound = /* @__PURE__ */ icon(G.User, "UserRound");
export const Users = /* @__PURE__ */ icon(G.Users, "Users");
export const UsersRound = /* @__PURE__ */ icon(G.UsersThree, "UsersRound");
export const UsersThree = /* @__PURE__ */ icon(G.UsersThree, "UsersThree");
export const Volume2 = /* @__PURE__ */ icon(G.SpeakerHigh, "Volume2");
export const Waveform = /* @__PURE__ */ icon(G.Waveform, "Waveform");
export const Wrench = /* @__PURE__ */ icon(G.Wrench, "Wrench");
export const X = /* @__PURE__ */ icon(G.X, "X");
export const ZoomIn = /* @__PURE__ */ icon(G.MagnifyingGlassPlus, "ZoomIn");
export const ZoomOut = /* @__PURE__ */ icon(G.MagnifyingGlassMinus, "ZoomOut");
