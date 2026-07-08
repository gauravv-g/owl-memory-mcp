# Design System
## Public Finance Intelligence Platform

**Version**: 1.0  
**Derived From**: [PRD.md](./PRD.md), [InformationArchitecture.md](./InformationArchitecture.md), [Vision.md](./Vision.md)  
**Status**: Approved

---

## 1. Design Principles

### 1.1 Core Philosophy

1. **Clarity Over Cleverness**: Every element must be immediately understandable
2. **Accessibility First**: Design for users with disabilities from the start, not as an afterthought
3. **Progressive Disclosure**: Show simple information first, allow deep dives
4. **Consistency**: Same patterns across all screens and platforms
5. **Performance**: Design choices must support fast loading on low-end devices
6. **Cultural Sensitivity**: Colors, icons, and imagery appropriate for Indian context

### 1.2 Design Tenets

- **Readable**: Minimum 16sp body text, high contrast ratios
- **Touchable**: Minimum 48dp touch targets
- **Forgiving**: Clear error states, easy recovery
- **Efficient**: Common actions reachable within 1-2 taps
- **Trustworthy**: Professional appearance, transparent data sourcing

---

## 2. Color Palette

### 2.1 Primary Colors

```kotlin
// Primary Brand Colors
val TricolorSaffron = Color(0xFFFF9933)  // India flag saffron
val TricolorGreen = Color(0xFF138808)    // India flag green
val TricolorBlue = Color(0xFF000088)     // Ashoka Chakra blue

// Primary Action
val Primary = Color(0xFF2563EB)          // Trustworthy blue
val PrimaryVariant = Color(0xFF1D4ED8)
val OnPrimary = Color(0xFFFFFFFF)

// Secondary Accent
val Secondary = Color(0xFF10B981)        // Growth/emerald green
val SecondaryVariant = Color(0xFF059669)
val OnSecondary = Color(0xFFFFFFFF)
```

### 2.2 Neutral Palette

```kotlin
// Light Theme
val Gray50 = Color(0xFFF9FAFB)
val Gray100 = Color(0xFFF3F4F6)
val Gray200 = Color(0xFFE5E7EB)
val Gray300 = Color(0xFFD1D5DB)
val Gray400 = Color(0xFF9CA3AF)
val Gray500 = Color(0xFF6B7280)
val Gray600 = Color(0xFF4B5563)
val Gray700 = Color(0xFF374151)
val Gray800 = Color(0xFF1F2937)
val Gray900 = Color(0xFF111827)

// Dark Theme
val DarkGray50 = Color(0xFF1F2937)
val DarkGray100 = Color(0xFF374151)
val DarkGray200 = Color(0xFF4B5563)
val DarkGray300 = Color(0xFF6B7280)
val DarkGray400 = Color(0xFF9CA3AF)
val DarkGray500 = Color(0xFFD1D5DB)
val DarkGray600 = Color(0xFFE5E7EB)
val DarkGray700 = Color(0xFFF3F4F6)
val DarkGray800 = Color(0xFFF9FAFB)
val DarkGray900 = Color(0xFFFFFFFF)
```

### 2.3 Semantic Colors

```kotlin
// Status Colors
val Success = Color(0xFF10B981)
val Warning = Color(0xFFF59E0B)
val Error = Color(0xFFEF4444)
val Info = Color(0xFF3B82F6)

// Data Visualization
val BudgetAllocation = Color(0xFF3B82F6)    // Blue
val BudgetUtilized = Color(0xFF10B981)      // Green
val BudgetRemaining = Color(0xFFF59E0B)     // Amber
val BudgetOverspent = Color(0xFFEF4444)     // Red

// Chart Palette (Colorblind Safe)
val ChartColors = listOf(
    Color(0xFF1F77B4),  // Blue
    Color(0xFFFF7F0E),  // Orange
    Color(0xFF2CA02C),  // Green
    Color(0xFFD62728),  // Red
    Color(0xFF9467BD),  // Purple
    Color(0xFF8C564B),  // Brown
    Color(0xFFE377C2),  // Pink
    Color(0xFF7F7F7F),  // Gray
    Color(0xFFBCBD22),  // Olive
    Color(0xFF17BECF)   // Cyan
)
```

### 2.4 Background & Surface

```kotlin
// Light Theme
val Background = Color(0xFFFFFFFF)
val Surface = Color(0xFFF9FAFB)
val CardBackground = Color(0xFFFFFFFF)
val OnBackground = Color(0xFF111827)
val OnSurface = Color(0xFF111827)

// Dark Theme
val DarkBackground = Color(0xFF111827)
val DarkSurface = Color(0xFF1F2937)
val DarkCardBackground = Color(0xFF374151)
val DarkOnBackground = Color(0xFFF9FAFB)
val DarkOnSurface = Color(0xFFF9FAFB)
```

---

## 3. Typography

### 3.1 Font Families

```kotlin
// Primary Font: Inter (Latin script)
val FontFamilyLatin = FontFamily.Default  // Inter from Google Fonts

// Hindi Font: Noto Sans Devanagari
val FontFamilyDevanagari = FontFamily(...)  // Noto Sans Devanagari

// Other Indian Scripts
val FontFamilyTamil = FontFamily(...)       // Noto Sans Tamil
val FontFamilyTelugu = FontFamily(...)      // Noto Sans Telugu
val FontFamilyBengali = FontFamily(...)     // Noto Sans Bengali
val FontFamilyGujarati = FontFamily(...)    // Noto Sans Gujarati
// ... additional scripts as needed

// Fallback
val FontFamilyDefault = FontFamily.SansSerif
```

### 3.2 Type Scale

| Style | Size | Weight | Line Height | Letter Spacing | Use Case |
|-------|------|--------|-------------|----------------|----------|
| Display Large | 32sp | Bold (700) | 40sp | -0.5sp | Screen titles |
| Display Medium | 28sp | Bold (700) | 36sp | -0.5sp | Section headers |
| Display Small | 24sp | SemiBold (600) | 32sp | 0sp | Card titles |
| Headline Large | 22sp | SemiBold (600) | 28sp | 0sp | Major sections |
| Headline Medium | 20sp | SemiBold (600) | 28sp | 0sp | Subsections |
| Headline Small | 18sp | Medium (500) | 24sp | 0sp | Group headers |
| Title Large | 16sp | Medium (500) | 24sp | 0.15sp | Button text |
| Title Medium | 14sp | Medium (500) | 20sp | 0.1sp | List items |
| Title Small | 12sp | Medium (500) | 16sp | 0.1sp | Captions |
| Body Large | 16sp | Regular (400) | 24sp | 0.5sp | Paragraphs |
| Body Medium | 14sp | Regular (400) | 20sp | 0.25sp | Descriptions |
| Body Small | 12sp | Regular (400) | 16sp | 0.4sp | Helper text |
| Label Large | 14sp | Medium (500) | 20sp | 0.1sp | Form labels |
| Label Medium | 12sp | Medium (500) | 16sp | 0.5sp | Chip text |
| Label Small | 11sp | Medium (500) | 16sp | 0.5sp | Overlines |

### 3.3 Typography Usage Examples

```kotlin
// Screen Title
Text(
    text = "Union Budget 2024-25",
    style = MaterialTheme.typography.displaySmall,
    color = MaterialTheme.colorScheme.onBackground
)

// Card Title
Text(
    text = "Ministry of Education",
    style = MaterialTheme.typography.titleLarge,
    fontWeight = FontWeight.SemiBold
)

// Body Content
Text(
    text = "The Ministry of Education has been allocated ₹1,24,877 crore for FY 2024-25...",
    style = MaterialTheme.typography.bodyLarge,
    lineHeight = 24.sp
)

// Numbers (Special styling for amounts)
Text(
    text = "₹1,24,877 Cr",
    style = MaterialTheme.typography.headlineMedium,
    fontWeight = FontWeight.Bold,
    fontFamily = FontFamily.Monospace  // For tabular numbers
)
```

---

## 4. Spacing & Layout

### 4.1 Spacing Scale

Base unit: 4dp

| Token | Value | Use Case |
|-------|-------|----------|
| xs | 4dp | Tight spacing, icon padding |
| sm | 8dp | Related elements |
| md | 16dp | Standard spacing |
| lg | 24dp | Section separation |
| xl | 32dp | Major sections |
| 2xl | 48dp | Page margins |
| 3xl | 64dp | Large gaps |

### 4.2 Grid System

```
Mobile (Portrait):
- Columns: 4
- Margin: 16dp
- Gutter: 16dp

Tablet (Portrait):
- Columns: 8
- Margin: 24dp
- Gutter: 24dp

Tablet (Landscape) / Web:
- Columns: 12
- Margin: 32dp (max-width: 1440dp)
- Gutter: 32dp
```

### 4.3 Layout Templates

```kotlin
// Card Padding
val CardPadding = PaddingValues(16.dp)

// Screen Padding
val ScreenHorizontalPadding = PaddingValues(horizontal = 16.dp)
val ScreenVerticalPadding = PaddingValues(vertical = 16.dp)

// Content Spacing
val SectionSpacing = 24.dp
val ElementSpacing = 16.dp
val TightSpacing = 8.dp
```

---

## 5. Components

### 5.1 Buttons

#### Primary Button
```kotlin
// Specifications
Height: 48dp
Min Width: 120dp
Corner Radius: 8dp
Background: Primary color
Text: OnPrimary, Title Large, Medium
Elevation: 2dp (resting), 4dp (pressed)

// Usage
Button(
    onClick = { },
    modifier = Modifier.fillMaxWidth(),
    colors = ButtonDefaults.buttonColors(
        containerColor = MaterialTheme.colorScheme.primary
    )
) {
    Text("View Budget Details")
}
```

#### Secondary Button
```kotlin
// Specifications
Height: 48dp
Min Width: 120dp
Corner Radius: 8dp
Border: 1px Primary color
Background: Transparent
Text: Primary color, Title Large, Medium

// Usage
OutlinedButton(
    onClick = { },
    modifier = Modifier.fillMaxWidth(),
    border = BorderStroke(1.dp, MaterialTheme.colorScheme.primary)
) {
    Text("Compare States")
}
```

#### Text Button
```kotlin
// Specifications
Height: 40dp
Padding: 8dp horizontal
Text: Primary color, Title Medium, Medium

// Usage
TextButton(onClick = { }) {
    Text("Learn More")
}
```

#### Icon Button
```kotlin
// Specifications
Size: 48dp (touch target)
Icon: 24dp
Padding: 12dp

// Usage
IconButton(onClick = { }) {
    Icon(
        imageVector = Icons.Default.Search,
        contentDescription = "Search"
    )
}
```

### 5.2 Cards

#### Standard Card
```kotlin
// Specifications
Padding: 16dp
Corner Radius: 12dp
Background: Surface
Elevation: 2dp
Border: None (Light), 1px Gray700 (Dark)

// Usage
Card(
    elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
    shape = RoundedCornerShape(12.dp)
) {
    Column(modifier = Modifier.padding(16.dp)) {
        // Card content
    }
}
```

#### Interactive Card
```kotlin
// Specifications
Same as Standard Card +
Ripple Effect on press
Hover state (web)

// Usage
Card(
    onClick = { },
    elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
) {
    // Clickable card content
}
```

#### Stat Card
```kotlin
// Specialized for displaying numbers
// Layout: Label (top), Value (center), Change indicator (bottom)

Column {
    Text("Total Allocation", style = MaterialTheme.typography.labelLarge)
    Text("₹1,24,877 Cr", style = MaterialTheme.typography.headlineMedium)
    Row {
        Icon(Icons.Default.TrendingUp, contentDescription = null)
        Text("+12% from last year", color = Success)
    }
}
```

### 5.3 Input Fields

#### Text Field
```kotlin
// Specifications
Height: 56dp
Corner Radius: 8dp
Border: 1px Gray300 (default), 2px Primary (focused)
Padding: 16dp horizontal
Label: Label Large, Gray500
Error: Error color, 1px border

// Usage
OutlinedTextField(
    value = query,
    onValueChange = { query = it },
    label = { Text("Search budgets, schemes...") },
    leadingIcon = {
        Icon(Icons.Default.Search, contentDescription = null)
    },
    modifier = Modifier.fillMaxWidth()
)
```

#### Search Bar (Specialized)
```kotlin
// Full-width search with voice input
// Includes recent searches dropdown

SearchBar(
    query = query,
    onQueryChange = { query = it },
    onSearch = { performSearch(it) },
    active = isActive,
    onActiveChange = { isActive = it },
    placeholder = { Text("Search public finance data...") },
    leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
    trailingIcon = {
        IconButton(onClick = { startVoiceInput() }) {
            Icon(Icons.Default.Mic, contentDescription = "Voice search")
        }
    }
)
```

### 5.4 Chips

#### Filter Chip
```kotlin
// Specifications
Height: 32dp
Corner Radius: 16dp (pill shape)
Border: 1px Gray300 (unselected), Primary (selected)
Padding: 8dp horizontal, 4dp vertical
Text: Label Medium

// Usage
FilterChip(
    selected = isSelected,
    onClick = { toggle() },
    label = { Text("2024-25") }
)
```

#### Action Chip
```kotlin
// Includes icon + text
// Used for quick actions

ActionChip(
    onClick = { exportData() },
    label = { Text("Export CSV") },
    leadingIcon = {
        Icon(Icons.Default.Download, contentDescription = null)
    }
)
```

### 5.5 Navigation

#### Bottom Navigation Bar
```kotlin
// Specifications
Height: 80dp (with label)
Background: Surface
Elevation: 8dp
Items: 5 maximum
Icon Size: 24dp
Active Indicator: Pill shape, Primary container

// Usage
NavigationBar {
    NavigationBarItem(
        selected = currentRoute == "home",
        onClick = { navigate("home") },
        icon = { Icon(Icons.Default.Home, contentDescription = "Home") },
        label = { Text("Home") }
    )
    // ... more items
}
```

#### Top App Bar
```kotlin
// Specifications
Height: 64dp
Title: Title Large, SemiBold
Actions: Right-aligned icon buttons

// Usage
TopAppBar(
    title = { Text("Budget Explorer") },
    actions = {
        IconButton(onClick = { }) {
            Icon(Icons.Default.MoreVert, contentDescription = "More")
        }
    }
)
```

### 5.6 Data Display

#### Table
```kotlin
// Specifications
Row Height: 56dp (default), 72dp (with description)
Header Height: 48dp
Border: 1px Gray200 (horizontal only)
Padding: 12dp horizontal

// Usage
DataTable {
    DataTableHeader {
        NumericColumnHeader("2023-24")
        NumericColumnHeader("2024-25")
        NumericColumnHeader("Change %")
    }
    DataRow {
        DataCell(Text("Education"))
        NumericCell(Text("₹1,12,000 Cr"))
        NumericCell(Text("₹1,24,877 Cr"))
        NumericCell(Text("+11.5%"), color = Success)
    }
}
```

#### Chart Containers
```kotlin
// Specifications
Aspect Ratio: 16:9 (standard), 1:1 (comparison)
Padding: 16dp
Legend: Below chart, scrollable if needed
Tooltip: On hover/tap, Surface background

// Chart styling guidelines
- Use colorblind-safe palette
- Include data labels for key points
- Provide text alternative for screen readers
- Animate on load (optional, respect reduced motion)
```

### 5.7 Dialogs & Bottom Sheets

#### Dialog
```kotlin
// Specifications
Max Width: 320dp (mobile), 560dp (tablet)
Corner Radius: 16dp
Padding: 24dp
Title: Title Large
Content: Body Large
Actions: Right-aligned, minimum 64dp height

// Usage
AlertDialog(
    onDismissRequest = { showDialog = false },
    title = { Text("Confirm Export") },
    text = { Text("This will download 5 years of budget data (~10MB). Continue?") },
    confirmButton = {
        Button(onClick = { exportData() }) {
            Text("Download")
        }
    },
    dismissButton = {
        TextButton(onClick = { showDialog = false }) {
            Text("Cancel")
        }
    }
)
```

#### Bottom Sheet
```kotlin
// Specifications
Handle: 32dp wide, 4dp tall, Gray400
Max Height: 90% screen
Corner Radius: 16dp (top only)
Padding: 16dp

// Usage
ModalBottomSheet(
    onDismissRequest = { showSheet = false },
    sheetState = sheetState
) {
    Column {
        // Sheet handle
        Spacer(Modifier.height(8.dp))
        Box(
            modifier = Modifier
                .size(32.dp, 4.dp)
                .background(Color.Gray, RoundedCornerShape(2.dp))
        )
        Spacer(Modifier.height(16.dp))
        
        // Sheet content
        Text("Filter Options", style = MaterialTheme.typography.titleLarge)
        // ... filter controls
    }
}
```

### 5.8 Loading States

#### Shimmer Loading
```kotlin
// Specifications
Background: Gray100 to Gray200 gradient animation
Duration: 1.2s infinite
Used for: Cards, lists, charts while loading

// Usage
ShimmerLoadingCard {
    // Skeleton structure matching loaded content
}
```

#### Progress Indicator
```kotlin
// Circular (for indeterminate)
CircularProgressIndicator(
    modifier = Modifier.size(48.dp),
    strokeWidth = 4.dp
)

// Linear (for determinate)
LinearProgressIndicator(
    progress = 0.75f,  // 0.0 to 1.0
    modifier = Modifier.fillMaxWidth()
)
```

### 5.9 Badges & Indicators

#### Status Badge
```kotlin
// Specifications
Height: 20dp
Padding: 4dp horizontal, 2dp vertical
Corner Radius: 10dp
Text: Label Small

// Color coding
Success badge: Success background, white text
Warning badge: Warning background, white text
Error badge: Error background, white text
Info badge: Info background, white text

// Usage
Badge(
    containerColor = Success,
    contentColor = Color.White
) {
    Text("Verified")
}
```

---

## 6. Elevation & Shadows

### 6.1 Elevation Scale

| Level | Light Theme Shadow | Dark Theme Shadow | Use Case |
|-------|-------------------|-------------------|----------|
| 0 | None | None | Flat surfaces |
| 1 | 0px 1px 2px rgba(0,0,0,0.1) | 0px 1px 2px rgba(0,0,0,0.3) | Cards (resting) |
| 2 | 0px 2px 4px rgba(0,0,0,0.1) | 0px 2px 4px rgba(0,0,0,0.3) | Cards (hover) |
| 3 | 0px 4px 8px rgba(0,0,0,0.1) | 0px 4px 8px rgba(0,0,0,0.3) | FAB, dialogs |
| 4 | 0px 6px 12px rgba(0,0,0,0.15) | 0px 6px 12px rgba(0,0,0,0.4) | Modals |
| 5 | 0px 8px 16px rgba(0,0,0,0.15) | 0px 8px 16px rgba(0,0,0,0.4) | Popovers |

### 6.2 Implementation

```kotlin
// Compose
Card(
    elevation = CardDefaults.cardElevation(
        defaultElevation = 2.dp,
        pressedElevation = 1.dp,
        hoveredElevation = 3.dp
    )
)

// Custom shadow
Box(
    modifier = Modifier
        .shadow(
            elevation = 4.dp,
            shape = RoundedCornerShape(12.dp),
            clip = false
        )
)
```

---

## 7. Icons

### 7.1 Icon Library

Primary: Material Symbols (Outlined variant)
Fallback: Material Icons (Regular)

### 7.2 Icon Sizes

| Context | Size | Container |
|---------|------|-----------|
| Navigation | 24dp | 48dp |
| Buttons | 24dp | 48dp |
| Inline | 20dp | - |
| Small badges | 16dp | 24dp |
| Charts | 20dp | - |

### 7.3 Custom Icons

Required custom icons for this project:
- Budget/Finance related (rupee, allocation, expenditure)
- Government/Public sector (building, document official)
- Data visualization (chart types, trends)
- India-specific (map, constituency, panchayat)

```kotlin
// Example custom icon usage
Icon(
    imageVector = AppIcons.RupeeCircle,
    contentDescription = "Budget amount",
    tint = MaterialTheme.colorScheme.primary
)
```

### 7.4 Icon Accessibility

- Always provide `contentDescription`
- Decorative icons: `contentDescription = null`
- Action icons: Describe the action, not the icon
- Complex icons: Provide detailed descriptions

---

## 8. Animations

### 8.1 Animation Principles

1. **Purposeful**: Every animation should have a reason
2. **Subtle**: Duration 200-400ms, ease-in-out curves
3. **Performant**: Use Compose animation APIs, avoid layout thrashing
4. **Respect Preferences**: Honor "Reduce Motion" system setting

### 8.2 Standard Durations

| Animation Type | Duration | Easing |
|---------------|----------|--------|
| Fade in/out | 200ms | EaseInOut |
| Slide (short) | 250ms | EaseOutCubic |
| Slide (long) | 350ms | EaseOutCubic |
| Scale | 200ms | Spring (stiffness: Medium) |
| Shimmer | 1200ms | Linear (infinite) |
| Progress | 300ms | EaseInOut |

### 8.3 Common Animations

```kotlin
// Fade In
AnimatedVisibility(
    visible = isVisible,
    enter = fadeIn(animationSpec = tween(200))
)

// Slide Up
AnimatedVisibility(
    visible = isVisible,
    enter = slideInVertically(
        initialOffsetY = { it },
        animationSpec = tween(250, easing = FastOutSlowInEasing)
    ) + fadeIn()
)

// Number Count Up
animateIntAsState(
    targetValue = targetNumber,
    animationSpec = tween(durationMillis = 1000)
)

// Shimmer Effect
val infiniteTransition = rememberInfiniteTransition()
val alpha by infiniteTransition.animateFloat(
    initialValue = 0.5f,
    targetValue = 1f,
    animationSpec = infiniteRepeatable(
        animation = tween(600, easing = LinearEasing),
        repeatMode = RepeatMode.Reverse
    )
)
```

### 8.4 Reduced Motion Support

```kotlin
@Composable
fun rememberReducedMotionPreference(): Boolean {
    val context = LocalContext.current
    return Settings.Global.getFloat(
        context.contentResolver,
        Settings.Global.TRANSITION_ANIMATION_SCALE,
        1f
    ) == 0f
}

// Usage
val reduceMotion = rememberReducedMotionPreference()
val animationSpec = if (reduceMotion) {
    spring(stiffness = Spring.StiffnessInstantly)
} else {
    spring(stiffness = Spring.StiffnessMedium)
}
```

---

## 9. Accessibility

### 9.1 Color Contrast

Minimum Ratios (WCAG 2.1 AA):
- Normal text (< 18sp): 4.5:1
- Large text (≥ 18sp): 3:1
- UI components: 3:1
- Graphical objects: 3:1

### 9.2 Touch Targets

```kotlin
// Minimum touch target size
val MinTouchTarget = 48.dp

// Usage
Modifier
    .sizeIn(minWidth = 48.dp, minHeight = 48.dp)
    .clickable { /* action */ }
```

### 9.3 Content Descriptions

```kotlin
// Good examples
Icon(
    imageVector = Icons.Default.Search,
    contentDescription = "Search budgets and schemes"
)

Image(
    painter = painterResource(R.drawable.budget_chart),
    contentDescription = "Bar chart showing education budget increase from ₹1,12,000 crore in 2023-24 to ₹1,24,877 crore in 2024-25, a 11.5% increase"
)

// Decorative (no description needed)
Icon(
    imageVector = Icons.Default.ChevronRight,
    contentDescription = null,  // Decorative
    modifier = Modifier.semantics(mergeDescendants = true)
)
```

### 9.4 Screen Reader Optimization

```kotlin
// Group related elements
Semantics {
    heading()
    setProgress(0.75f)  // For progress indicators
    setStateDescription("Expanded")  // For expandable content
}

// Custom actions
SemanticActions {
    onClick(label = "Export data") {
        exportData()
    }
}

// Live regions for dynamic content
SemanticsProperties.LiveRegion = LiveRegionMode.Polite
```

### 9.5 Focus Management

```kotlin
// Focus order
FocusOrder = ColumnFocusOrder()

// Focus indicators
Modifier.focusIndicator { focusState ->
    if (focusState.isFocused) {
        BorderStroke(2.dp, MaterialTheme.colorScheme.primary)
    } else {
        BorderStroke(1.dp, Color.Transparent)
    }
}
```

---

## 10. Dark Mode

### 10.1 Dark Theme Specifications

```kotlin
val DarkColorScheme = darkColorScheme(
    primary = Color(0xFF90CAF9),
    onPrimary = Color(0xFF0D47A1),
    primaryContainer = Color(0xFF1565C0),
    secondary = Color(0xFF81C784),
    onSecondary = Color(0xFF1B5E20),
    background = Color(0xFF111827),
    surface = Color(0xFF1F2937),
    onSurface = Color(0xFFF9FAFB),
    error = Color(0xFFEF5350),
    onError = Color(0xFFB71C1C)
)
```

### 10.2 Dark Mode Guidelines

1. **Avoid Pure Black**: Use DarkGray900 (#111827) instead of #000000
2. **Reduce Saturation**: Colors appear more vibrant on dark backgrounds
3. **Elevation via Lightness**: Higher elevation = lighter surface
4. **Maintain Contrast**: Re-test all contrast ratios in dark mode
5. **Images**: Apply subtle overlay for better integration

### 10.3 Dark Mode Images

```kotlin
// Add overlay to images in dark mode
Box {
    AsyncImage(
        model = imageUrl,
        contentDescription = contentDescription,
        colorFilter = if (isDarkTheme) {
            ColorFilter.tint(Color.White.copy(alpha = 0.1f))
        } else {
            null
        }
    )
}
```

---

## 11. Responsive Design

### 11.1 Breakpoints

| Breakpoint | Min Width | Layout |
|------------|-----------|--------|
| Phone | 0-599dp | Single column, bottom nav |
| Small Tablet | 600-839dp | Two columns, rail nav |
| Large Tablet | 840-1199dp | Three columns, navigation drawer |
| Desktop | 1200dp+ | Multi-column, full sidebar |

### 11.2 Adaptive Layouts

```kotlin
@Composable
fun AdaptiveLayout(
    phoneContent: @Composable () -> Unit,
    tabletContent: @Composable () -> Unit
) {
    val widthDp = LocalConfiguration.current.screenWidthDp.dp
    
    when {
        widthDp < 600.dp -> phoneContent()
        else -> tabletContent()
    }
}

// Usage
AdaptiveLayout(
    phoneContent = {
        // Single column, bottom navigation
        PhoneLayout()
    },
    tabletContent = {
        // Two-pane layout, navigation rail
        TabletLayout()
    }
)
```

### 11.3 Foldable Support

```kotlin
// Detect hinge/fold position
val windowMetrics = WindowMetricsCalculator.getOrCreate()
    .computeMaximumWindowMetrics(activity)
val bounds = windowMetrics.bounds

// Place content on appropriate side of fold
if (bounds.width() > bounds.height()) {
    // Landscape with potential fold
    Row {
        // Left side
        Column { /* Navigation */ }
        
        // Right side (or separate pane if folded)
        Column { /* Content */ }
    }
}
```

---

## 12. Design Tokens (Export Format)

### 12.1 JSON Token Structure

```json
{
  "color": {
    "primary": "#2563EB",
    "secondary": "#10B981",
    "background": "#FFFFFF",
    "surface": "#F9FAFB"
  },
  "spacing": {
    "xs": "4dp",
    "sm": "8dp",
    "md": "16dp",
    "lg": "24dp",
    "xl": "32dp"
  },
  "typography": {
    "displayLarge": {
      "fontSize": "32sp",
      "fontWeight": "700",
      "lineHeight": "40sp"
    }
  },
  "radius": {
    "small": "8dp",
    "medium": "12dp",
    "large": "16dp"
  }
}
```

---

## Appendix A: Component Checklist

Before shipping any component, verify:
- [ ] Light mode appearance
- [ ] Dark mode appearance
- [ ] Screen reader compatibility
- [ ] Keyboard navigation (web)
- [ ] Touch target sizes ≥ 48dp
- [ ] Color contrast ratios meet WCAG AA
- [ ] Reduced motion support
- [ ] RTL language support (future)
- [ ] Loading state
- [ ] Error state
- [ ] Empty state
- [ ] Hover state (web/tablet)
- [ ] Focus indicators
- [ ] Animation performance

---

## Appendix B: Design Review Questions

1. Does this design work for users with low vision?
2. Is this usable on a ₹5,000 Android phone?
3. Can this be understood by someone with limited literacy?
4. Does this work offline or with poor connectivity?
5. Is the color scheme appropriate for Indian cultural context?
6. Have we tested this with actual government data (which can be messy)?
7. Does this scale to 22 languages without breaking layout?
8. Is this consistent with existing patterns in the app?

---

*This Design System is derived from PRD.md and InformationArchitecture.md. All UI implementations must adhere to these specifications. Any deviations require design review and documentation update.*
