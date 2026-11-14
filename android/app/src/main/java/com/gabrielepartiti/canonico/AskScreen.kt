@file:OptIn(ExperimentalMaterial3Api::class)

package com.gabrielepartiti.canonico

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.StartOffset
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun AskScreen(state: AppState) {
    val p = pal
    val listState = rememberLazyListState()
    var menu by remember { mutableStateOf(false) }
    var confirmReset by remember { mutableStateOf(false) }
    val suggestions = listOf(
        stringResource(R.string.ask_suggestion1),
        stringResource(R.string.ask_suggestion2),
        stringResource(R.string.ask_suggestion3),
    )
    val demo = state.projectId == "proj-clearpath"
    val header = (if (demo) 3 else 0) + (if (state.chat.isEmpty()) 1 else 0)

    LaunchedEffect(state.chat.size, state.chat.lastOrNull()?.key) {
        if (state.chat.isNotEmpty()) listState.animateScrollToItem(header + state.chat.size - 1)
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(p.bg)
            .imePadding(),
    ) {
        TopAppBar(
            windowInsets = WindowInsets(0),
            colors = TopAppBarDefaults.topAppBarColors(containerColor = p.bg),
            title = {
                Column {
                    Text(stringResource(R.string.tab_ask), fontWeight = FontWeight.SemiBold, fontSize = 18.sp)
                    if (state.projectName.isNotEmpty()) {
                        Text(state.projectName, fontSize = 12.sp, color = p.secondary)
                    }
                }
            },
            actions = {
                Box {
                    IconButton(onClick = { menu = true }, modifier = Modifier.testTag("ask_menu")) {
                        Icon(Icons.Filled.MoreVert, contentDescription = stringResource(R.string.common_more))
                    }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        DropdownMenuItem(text = { Text(stringResource(R.string.ask_clear)) }, onClick = {
                            menu = false
                            state.clearChat()
                        })
                        DropdownMenuItem(text = { Text(stringResource(R.string.settings_reset)) }, onClick = {
                            menu = false
                            confirmReset = true
                        }, modifier = Modifier.testTag("menu_reset"))
                    }
                }
            },
        )

        LazyColumn(
            state = listState,
            modifier = Modifier.weight(1f).fillMaxWidth().testTag("ask_list"),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            if (demo) {
                item(key = "lm_div") { DayDivider(stringResource(R.string.ask_lastMonday)) }
                item(key = "lm_q") { UserBubble(suggestions[0]) }
                item(key = "lm_a") { StaleAnswer() }
            }
            if (state.chat.isEmpty()) {
                item(key = "empty") {
                    EmptyAsk(suggestions) { state.ask(it) }
                }
            }
            items(state.chat, key = { it.key }) { item ->
                when (item) {
                    is ChatItem.Divider -> DayDivider(item.text)
                    is ChatItem.Question -> UserBubble(item.text)
                    is ChatItem.Pending -> TypingDots()
                    is ChatItem.Failure -> ErrorBanner(item.message)
                    is ChatItem.Answer -> AnswerBlock(state, item.res)
                }
            }
        }

        Composer(state)
    }

    if (confirmReset) {
        AlertDialog(
            onDismissRequest = { confirmReset = false },
            text = { Text(stringResource(R.string.settings_resetConfirm)) },
            confirmButton = {
                TextButton(onClick = {
                    confirmReset = false
                    state.resetDemo()
                }, modifier = Modifier.testTag("confirm_reset")) { Text(stringResource(R.string.settings_reset), color = p.red) }
            },
            dismissButton = { TextButton(onClick = { confirmReset = false }) { Text(stringResource(R.string.common_cancel)) } },
        )
    }
}

@Composable
private fun DayDivider(text: String) {
    Text(
        text,
        fontSize = 12.sp,
        fontWeight = FontWeight.SemiBold,
        color = pal.secondary,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
    )
}

@Composable
private fun UserBubble(text: String) {
    Row(Modifier.fillMaxWidth()) {
        Spacer(Modifier.weight(1f).widthIn(min = 48.dp))
        Text(
            text,
            fontSize = 16.sp,
            color = pal.text,
            modifier = Modifier
                .widthIn(max = 300.dp)
                .clip(RoundedCornerShape(22.dp))
                .background(pal.bubble)
                .padding(horizontal = 16.dp, vertical = 10.dp),
        )
    }
}

@Composable
private fun AssistantHeader(name: String, sub: String? = null, pill: @Composable () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        BrandMark(20.dp)
        Spacer(Modifier.width(8.dp))
        Text(name, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = pal.text)
        if (sub != null) {
            Text(" · $sub", fontSize = 12.sp, color = pal.tertiary, maxLines = 1)
        }
        Spacer(Modifier.weight(1f))
        pill()
    }
}

@Composable
private fun StaleAnswer() {
    val p = pal
    Column(Modifier.fillMaxWidth().alpha(0.85f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        AssistantHeader(stringResource(R.string.ask_companyAssistant), stringResource(R.string.ask_plainTag)) {
            Pill(stringResource(R.string.ask_wrong), p.red, dot = true)
        }
        Text(
            stringResource(R.string.ask_oldAnswer),
            fontSize = 20.sp,
            fontWeight = FontWeight.SemiBold,
            color = p.secondary,
            style = TextStyle(textDecoration = TextDecoration.LineThrough),
        )
        SourceChip(stringResource(R.string.ask_oldSource), "", color = p.secondary)
    }
}

@Composable
private fun EmptyAsk(suggestions: List<String>, onAsk: (String) -> Unit) {
    val p = pal
    Column(
        Modifier.fillMaxWidth().padding(top = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        BrandMark(44.dp)
        Text(
            stringResource(R.string.ask_empty),
            fontSize = 22.sp,
            fontWeight = FontWeight.SemiBold,
            color = p.text,
            textAlign = TextAlign.Center,
        )
        Text(
            stringResource(R.string.ask_emptySubtitle),
            fontSize = 14.sp,
            color = p.secondary,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 24.dp),
        )
        Spacer(Modifier.height(4.dp))
        suggestions.forEachIndexed { i, s ->
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(16.dp))
                    .background(p.card)
                    .border(1.dp, p.hairline, RoundedCornerShape(16.dp))
                    .clickable { onAsk(s) }
                    .padding(horizontal = 16.dp, vertical = 14.dp)
                    .testTag("suggestion_$i"),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(s, fontSize = 15.sp, color = p.text, modifier = Modifier.weight(1f))
                Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = p.tertiary)
            }
        }
    }
}

@Composable
private fun TypingDots() {
    val p = pal
    val transition = rememberInfiniteTransition(label = "dots")
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.testTag("typing")) {
        BrandMark(20.dp)
        Spacer(Modifier.width(12.dp))
        repeat(3) { i ->
            val a by transition.animateFloat(
                initialValue = 0.25f,
                targetValue = 1f,
                animationSpec = infiniteRepeatable(tween(500), RepeatMode.Reverse, StartOffset(i * 160)),
                label = "dot$i",
            )
            Box(
                Modifier
                    .padding(horizontal = 3.dp)
                    .size(8.dp)
                    .alpha(a)
                    .clip(CircleShape)
                    .background(p.secondary),
            )
        }
    }
}

@Composable
fun AnswerBlock(state: AppState, res: AskResponse) {
    val p = pal
    val clipboard = LocalClipboardManager.current
    var showQuote by remember { mutableStateOf(false) }
    val copied = stringResource(R.string.ask_copied)
    Column(Modifier.fillMaxWidth().testTag("answer"), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        AssistantHeader("Canonico") {
            when (res.status) {
                "binding" -> Pill(stringResource(R.string.fact_binding), p.binding, dot = true, filled = true)
                "contested" -> Pill(stringResource(R.string.ask_contested), p.amber, dot = true)
                else -> Pill(stringResource(R.string.ask_noAnswer), p.secondary)
            }
        }
        Text(Fmt.headline(res.answer), fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = p.text)
        val rest = Fmt.rest(res.answer)
        if (rest.isNotEmpty()) {
            Text(rest, fontSize = 15.sp, color = p.secondary, lineHeight = 21.sp)
        }

        res.binding?.let { b ->
            SourceChip(b.sourceLabel, Fmt.date(b.date), onClick = { showQuote = !showQuote })
            val q = b.quote
            if (q != null) {
                AnimatedVisibility(showQuote) { QuoteBlock(q) }
            }
        }

        val reason = res.changedBecause
        if (res.binding?.isPinned == true) {
            Callout(stringResource(R.string.ask_pinnedWins))
        } else if (!reason.isNullOrBlank()) {
            Callout(stringResource(R.string.ask_changedBecause, reason.trim('.', ' ')))
        }

        val conflicts = res.conflicts
        if (res.status == "contested" && !conflicts.isNullOrEmpty()) {
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(p.amberSoft).padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                conflicts.forEach { f ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(6.dp).clip(CircleShape).background(p.amber))
                        Spacer(Modifier.width(8.dp))
                        Text(f.value, fontSize = 14.sp, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
                        Text("${f.sourceLabel} · ${Fmt.date(f.date)}", fontSize = 11.sp, color = p.secondary)
                    }
                }
            }
        }

        Row(verticalAlignment = Alignment.CenterVertically) {
            val topic = res.binding?.topic ?: res.conflicts?.firstOrNull()?.topic
            if (topic != null) {
                TextButton(
                    onClick = { state.openTopic(topic) },
                    contentPadding = PaddingValues(horizontal = 8.dp),
                    modifier = Modifier.testTag("open_topic"),
                ) {
                    Icon(Icons.AutoMirrored.Filled.List, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(stringResource(R.string.memory_believes), fontSize = 14.sp)
                }
            }
            Spacer(Modifier.weight(1f))
            IconButton(onClick = {
                clipboard.setText(AnnotatedString(res.answer ?: ""))
                state.show(copied)
            }) { Icon(Icons.Filled.Share, contentDescription = stringResource(R.string.ask_copy), tint = p.secondary, modifier = Modifier.size(18.dp)) }
            val q = res.question
            if (!q.isNullOrBlank()) {
                IconButton(onClick = { state.ask(q) }) {
                    Icon(Icons.Filled.Refresh, contentDescription = stringResource(R.string.ask_askAgain), tint = p.secondary, modifier = Modifier.size(18.dp))
                }
            }
        }
    }
}

@Composable
private fun Callout(text: String) {
    val p = pal
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(p.bindingSoft)
            .padding(12.dp)
            .testTag("changed_because"),
        verticalAlignment = Alignment.Top,
    ) {
        Icon(Icons.Filled.Refresh, contentDescription = null, tint = p.binding, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(10.dp))
        Text(text, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = p.text)
    }
}

@Composable
private fun Composer(state: AppState) {
    val p = pal
    val canSend = !state.askBusy && state.askInput.isNotBlank()
    Row(
        Modifier
            .fillMaxWidth()
            .background(p.bg)
            .padding(horizontal = 12.dp, vertical = 8.dp)
            .clip(RoundedCornerShape(26.dp))
            .background(p.card)
            .border(1.dp, p.hairline, RoundedCornerShape(26.dp))
            .padding(start = 18.dp, end = 6.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.weight(1f).padding(vertical = 8.dp)) {
            if (state.askInput.isEmpty()) {
                Text(stringResource(R.string.ask_composer), color = p.tertiary, fontSize = 16.sp)
            }
            BasicTextField(
                value = state.askInput,
                onValueChange = { state.askInput = it },
                textStyle = TextStyle(color = p.text, fontSize = 16.sp),
                cursorBrush = SolidColor(p.binding),
                maxLines = 4,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { state.ask() }),
                modifier = Modifier.fillMaxWidth().testTag("ask_input"),
            )
        }
        Spacer(Modifier.width(8.dp))
        Box(
            Modifier
                .size(36.dp)
                .clip(CircleShape)
                .background(if (canSend) p.text else p.tertiary.copy(alpha = 0.4f))
                .clickable(enabled = canSend) { state.ask() }
                .testTag("ask_send"),
            contentAlignment = Alignment.Center,
        ) {
            if (state.askBusy) {
                CircularProgressIndicator(color = p.bg, strokeWidth = 2.dp, modifier = Modifier.size(16.dp))
            } else {
                Icon(Icons.Filled.KeyboardArrowUp, contentDescription = null, tint = if (canSend) p.bg else Color.White)
            }
        }
    }
}
