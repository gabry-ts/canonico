package com.gabrielepartiti.canonico

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

data class Pal(
    val binding: Color,
    val amber: Color,
    val bindingSoft: Color,
    val amberSoft: Color,
    val card: Color,
    val bg: Color,
    val hairline: Color,
    val text: Color,
    val secondary: Color,
    val tertiary: Color,
    val bubble: Color,
    val green: Color,
    val red: Color,
)

private val lightPal = Pal(
    binding = Color(0xFF2663EB),
    amber = Color(0xFFB87305),
    bindingSoft = Color(0xFF2663EB).copy(alpha = 0.10f),
    amberSoft = Color(0xFFF5B226).copy(alpha = 0.13f),
    card = Color.White,
    bg = Color(0xFFF2F2F7),
    hairline = Color.Black.copy(alpha = 0.07f),
    text = Color(0xFF111114),
    secondary = Color(0xFF6B6B73),
    tertiary = Color(0xFFA1A1A8),
    bubble = Color(0xFFE6E6EB),
    green = Color(0xFF1E9E4A),
    red = Color(0xFFE5342B),
)

private val darkPal = Pal(
    binding = Color(0xFF6194FF),
    amber = Color(0xFFFAB840),
    bindingSoft = Color(0xFF6194FF).copy(alpha = 0.14f),
    amberSoft = Color(0xFFF5B226).copy(alpha = 0.13f),
    card = Color(0xFF1C1C1E),
    bg = Color(0xFF000000),
    hairline = Color.White.copy(alpha = 0.09f),
    text = Color(0xFFF2F2F5),
    secondary = Color(0xFF9C9CA5),
    tertiary = Color(0xFF66666E),
    bubble = Color(0xFF2C2C2E),
    green = Color(0xFF34C759),
    red = Color(0xFFFF453A),
)

val LocalPal = staticCompositionLocalOf { lightPal }

val pal: Pal
    @Composable @ReadOnlyComposable get() = LocalPal.current

@Composable
fun CanonicoTheme(dark: Boolean, content: @Composable () -> Unit) {
    val p = if (dark) darkPal else lightPal
    val scheme = if (dark) {
        darkColorScheme(
            primary = p.binding, onPrimary = Color.White,
            background = p.bg, onBackground = p.text,
            surface = p.bg, onSurface = p.text,
            surfaceVariant = p.card, onSurfaceVariant = p.secondary,
            surfaceContainer = p.card, surfaceContainerLow = p.card, surfaceContainerHigh = p.card,
            surfaceContainerLowest = p.card, surfaceContainerHighest = p.bubble,
            secondaryContainer = p.bindingSoft, onSecondaryContainer = p.binding,
            outline = p.tertiary, outlineVariant = p.hairline,
            error = p.red,
        )
    } else {
        lightColorScheme(
            primary = p.binding, onPrimary = Color.White,
            background = p.bg, onBackground = p.text,
            surface = p.bg, onSurface = p.text,
            surfaceVariant = p.card, onSurfaceVariant = p.secondary,
            surfaceContainer = p.card, surfaceContainerLow = p.card, surfaceContainerHigh = p.card,
            surfaceContainerLowest = p.card, surfaceContainerHighest = p.bubble,
            secondaryContainer = p.bindingSoft, onSecondaryContainer = p.binding,
            outline = p.tertiary, outlineVariant = p.hairline,
            error = p.red,
        )
    }
    MaterialTheme(colorScheme = scheme) {
        CompositionLocalProvider(LocalPal provides p) { content() }
    }
}

object Fmt {
    fun date(iso: String?): String {
        if (iso == null || iso.length < 10) return iso ?: ""
        return runCatching {
            LocalDate.parse(iso.take(10)).format(DateTimeFormatter.ofPattern("d MMM yyyy", Locale.getDefault()))
        }.getOrDefault(iso)
    }

    fun timestamp(iso: String?): String {
        if (iso == null) return ""
        return runCatching {
            DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
                .withLocale(Locale.getDefault())
                .withZone(ZoneId.systemDefault())
                .format(Instant.parse(iso))
        }.getOrElse { date(iso) }
    }

    fun headline(s: String?): String {
        if (s.isNullOrEmpty()) return ""
        val i = s.indexOf(". ")
        return if (i >= 0) s.substring(0, i) + "." else s
    }

    fun rest(s: String?): String {
        if (s == null) return ""
        val i = s.indexOf(". ")
        return if (i >= 0) s.substring(i + 2) else ""
    }
}

@Composable
fun BrandMark(size: Dp = 52.dp) {
    val p = pal
    Box(
        Modifier
            .size(size)
            .shadow(size * 0.18f, RoundedCornerShape(size * 0.27f), ambientColor = p.binding, spotColor = p.binding)
            .clip(RoundedCornerShape(size * 0.27f))
            .background(Brush.linearGradient(listOf(p.binding, p.binding.copy(alpha = 0.78f)))),
        contentAlignment = Alignment.Center,
    ) {
        Icon(Icons.Filled.Check, contentDescription = null, tint = Color.White, modifier = Modifier.size(size * 0.6f))
    }
}

@Composable
fun Pill(text: String, color: Color, dot: Boolean = false, filled: Boolean = false) {
    Row(
        Modifier
            .clip(CircleShape)
            .background(if (filled) color else color.copy(alpha = 0.14f))
            .padding(horizontal = 8.dp, vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (dot) {
            Box(Modifier.size(6.dp).clip(CircleShape).background(if (filled) Color.White else color))
            Spacer(Modifier.width(5.dp))
        }
        Text(text, color = if (filled) Color.White else color, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
    }
}

@Composable
fun QuoteBlock(text: String, color: Color = pal.binding, collapsible: Boolean = false) {
    var expanded by remember { mutableStateOf(false) }
    Row(
        Modifier
            .fillMaxWidth()
            .height(IntrinsicSize.Min)
            .then(if (collapsible) Modifier.clickable { expanded = !expanded } else Modifier),
    ) {
        Box(Modifier.width(3.dp).fillMaxHeight().clip(RoundedCornerShape(2.dp)).background(color))
        Spacer(Modifier.width(10.dp))
        Text(
            "“$text”",
            style = MaterialTheme.typography.bodyMedium,
            color = pal.text.copy(alpha = 0.82f),
            maxLines = if (collapsible && !expanded) 2 else Int.MAX_VALUE,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.animateContentSize(),
        )
    }
}

@Composable
fun SourceChip(label: String, date: String, color: Color = pal.binding, onClick: (() -> Unit)? = null) {
    Row(
        Modifier
            .clip(CircleShape)
            .background(color.copy(alpha = 0.10f))
            .border(0.5.dp, color.copy(alpha = 0.22f), CircleShape)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = 10.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("☰", color = color, fontSize = 10.sp)
        Spacer(Modifier.width(6.dp))
        Text(label, color = color, fontSize = 12.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (date.isNotEmpty()) {
            Text("  ·  ", color = color, fontSize = 12.sp)
            Text(date, color = color, fontSize = 12.sp, fontFamily = FontFamily.Monospace, maxLines = 1)
        }
    }
}

@Composable
fun ErrorBanner(message: String, retry: (() -> Unit)? = null) {
    val p = pal
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(p.red.copy(alpha = 0.08f))
            .padding(12.dp)
            .testTag("error_banner"),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Filled.Warning, contentDescription = null, tint = p.red, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(10.dp))
        Text(message, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
        if (retry != null) {
            TextButton(onClick = retry) { Text(stringResource(R.string.common_retry)) }
        }
    }
}

@Composable
fun EmptyState(text: String) {
    Box(Modifier.fillMaxWidth().padding(vertical = 40.dp), contentAlignment = Alignment.Center) {
        Text(text, color = pal.secondary, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
fun CCard(
    modifier: Modifier = Modifier,
    fill: Color = pal.card,
    stroke: Color = pal.hairline,
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val shape = RoundedCornerShape(18.dp)
    Column(
        modifier
            .fillMaxWidth()
            .clip(shape)
            .background(fill)
            .border(1.dp, stroke, shape)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
        content = content,
    )
}

@Composable
fun SectionHeader(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.labelLarge,
        color = pal.secondary,
        modifier = Modifier.padding(start = 4.dp, top = 4.dp),
    )
}
