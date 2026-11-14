@file:OptIn(ExperimentalMaterial3Api::class)

package com.gabrielepartiti.canonico

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

data class SheetReq(val kind: String, val fact: Fact)

private val strike = TextStyle(textDecoration = TextDecoration.LineThrough)

@Composable
fun TopicScreen(state: AppState, topicId: String) {
    val p = pal
    var chain by remember(topicId) { mutableStateOf<TopicChain?>(null) }
    var error by remember(topicId) { mutableStateOf<String?>(null) }
    var sheet by remember { mutableStateOf<SheetReq?>(null) }
    var justRetired by remember(topicId) { mutableStateOf(false) }
    var reload by remember { mutableIntStateOf(0) }

    LaunchedEffect(topicId, state.memoryVersion, reload) {
        try {
            chain = Api.get<TopicChain>("/topics/$topicId/chain")
            error = null
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            error = e.message
        }
    }

    val facts = chain?.facts ?: emptyList()
    val active = facts.filter { !it.isRetired }
    val binding = active.firstOrNull { it.isPinned }
        ?: active.filter { it.supersededBy == null && it.type != "SUPERSEDED" && it.type != "OPEN" }
            .maxByOrNull { it.date ?: "" }
    val replaced = facts.filter { it.id != binding?.id && (it.type == "SUPERSEDED" || (it.supersededBy != null && it.isRetired)) }
        .sortedByDescending { it.date ?: "" }
    val stillActive = facts.filter { it.id != binding?.id && it.supersededBy != null && !it.isRetired && it.type != "SUPERSEDED" }
    val shown = (listOfNotNull(binding) + replaced + stillActive).map { it.id }.toSet()
    val others = facts.filter { it.id !in shown }

    Column(Modifier.fillMaxSize().background(p.bg)) {
        TopAppBar(
            windowInsets = WindowInsets(0),
            colors = TopAppBarDefaults.topAppBarColors(containerColor = p.bg),
            title = {},
            navigationIcon = {
                IconButton(onClick = { if (state.topicStack.isNotEmpty()) state.topicStack.removeAt(state.topicStack.lastIndex) }) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.common_back))
                }
            },
        )
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
                .padding(bottom = 24.dp)
                .testTag("topic_screen"),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Column {
                Text(stringResource(R.string.memory_believes), fontSize = 32.sp, fontWeight = FontWeight.Bold, color = p.text, lineHeight = 38.sp)
                chain?.let { Text(it.topic.label, fontSize = 15.sp, color = p.secondary, modifier = Modifier.padding(top = 4.dp)) }
            }
            error?.let { ErrorBanner(it) { reload++ } }
            if (chain == null && error == null) {
                Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            }

            AnimatedVisibility(justRetired) {
                CCard(fill = p.green.copy(alpha = 0.10f), stroke = p.green.copy(alpha = 0.25f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = p.green, modifier = Modifier.size(26.dp))
                        Spacer(Modifier.width(12.dp))
                        Text(stringResource(R.string.fact_retiredBanner), fontSize = 14.sp, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
                        Spacer(Modifier.width(8.dp))
                        Button(
                            onClick = { state.askAgain() },
                            colors = ButtonDefaults.buttonColors(containerColor = p.binding),
                            modifier = Modifier.testTag("ask_again"),
                        ) {
                            Icon(Icons.Filled.Refresh, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(6.dp))
                            Text(stringResource(R.string.ask_askAgain))
                        }
                    }
                }
            }

            binding?.let { b ->
                CCard(fill = p.bindingSoft, stroke = p.binding.copy(alpha = 0.25f), onClick = { sheet = SheetReq("detail", b) }) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Pill(stringResource(if (b.isPinned) R.string.fact_pinned else R.string.fact_binding), p.binding, dot = true, filled = true)
                        Spacer(Modifier.weight(1f))
                        Text(Fmt.date(b.date), fontSize = 12.sp, fontFamily = FontFamily.Monospace, color = p.binding)
                    }
                    Text(b.value, fontSize = 34.sp, fontWeight = FontWeight.Bold, color = p.text, lineHeight = 40.sp, modifier = Modifier.testTag("binding_value"))
                    b.quote?.let { QuoteBlock(it) }
                    Text(b.docId ?: "", fontSize = 12.sp, fontFamily = FontFamily.Monospace, color = p.binding, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    HorizontalDivider(color = p.hairline)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        SmallAction(stringResource(if (b.isPinned) R.string.fact_unpin else R.string.fact_pin)) { sheet = SheetReq("pin", b) }
                        SmallAction(stringResource(R.string.fact_correct)) { sheet = SheetReq("correct", b) }
                        SmallAction(stringResource(R.string.fact_retire)) { sheet = SheetReq("retire", b) }
                    }
                }
            }

            stillActive.forEach { f ->
                CCard(fill = p.amberSoft, stroke = p.amber.copy(alpha = 0.35f), modifier = Modifier.testTag("stale_card")) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Pill(stringResource(R.string.fact_stillActive), p.amber, dot = true)
                        Spacer(Modifier.width(8.dp))
                        Text(
                            "${Fmt.date(f.date)} · ${f.sourceLabel}",
                            fontSize = 11.sp, fontFamily = FontFamily.Monospace, color = p.amber,
                            maxLines = 1, overflow = TextOverflow.Ellipsis,
                        )
                    }
                    Text(f.value, fontSize = 28.sp, fontWeight = FontWeight.Bold, color = p.text)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(stringResource(R.string.memory_staleNote), fontSize = 13.sp, color = p.amber, modifier = Modifier.weight(1f))
                        Spacer(Modifier.width(12.dp))
                        OutlinedButton(
                            onClick = { sheet = SheetReq("retire", f) },
                            border = androidx.compose.foundation.BorderStroke(1.dp, p.amber.copy(alpha = 0.6f)),
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = p.amber, containerColor = p.amber.copy(alpha = 0.12f)),
                            modifier = Modifier.testTag("retire_stale"),
                        ) { Text(stringResource(R.string.fact_retire), fontWeight = FontWeight.SemiBold) }
                    }
                }
            }

            if (replaced.isNotEmpty()) {
                SectionHeader(stringResource(R.string.memory_replaced, replaced.size))
                CCard {
                    replaced.forEachIndexed { i, f -> TimelineRow(f, last = i == replaced.lastIndex) { sheet = SheetReq("detail", f) } }
                }
            }

            if (others.isNotEmpty()) {
                SectionHeader(stringResource(R.string.memory_other))
                others.forEach { f ->
                    CCard(onClick = { sheet = SheetReq("detail", f) }) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(f.value, fontSize = 16.sp, fontWeight = FontWeight.Medium, style = if (f.isRetired) strike else TextStyle.Default, modifier = Modifier.weight(1f))
                            Pill(if (f.isRetired) stringResource(R.string.fact_retired) else (f.type ?: ""), p.secondary)
                        }
                        Text("${Fmt.date(f.date)} · ${f.sourceLabel}", fontSize = 11.sp, fontFamily = FontFamily.Monospace, color = p.secondary)
                    }
                }
            }
        }
    }

    sheet?.let { req ->
        FactSheet(state, req, binding, onDismiss = { sheet = null }, onRetired = { justRetired = true })
    }
}

@Composable
private fun SmallAction(text: String, onClick: () -> Unit) {
    val p = pal
    Text(
        text,
        fontSize = 13.sp,
        fontWeight = FontWeight.Medium,
        color = p.binding,
        modifier = Modifier
            .clip(CircleShape)
            .background(p.binding.copy(alpha = 0.10f))
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 6.dp),
    )
}

@Composable
private fun TimelineRow(f: Fact, last: Boolean, onClick: () -> Unit) {
    val p = pal
    Row(
        Modifier
            .fillMaxWidth()
            .height(IntrinsicSize.Min)
            .clickable(onClick = onClick),
    ) {
        Column(Modifier.width(12.dp).fillMaxHeight(), horizontalAlignment = Alignment.CenterHorizontally) {
            Box(
                Modifier
                    .padding(top = 5.dp)
                    .size(10.dp)
                    .border(1.5.dp, p.secondary.copy(alpha = 0.5f), CircleShape),
            )
            if (!last) Box(Modifier.width(1.5.dp).weight(1f).background(p.secondary.copy(alpha = 0.25f)))
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.padding(bottom = if (last) 0.dp else 14.dp)) {
            Text(f.value, fontSize = 16.sp, color = p.secondary, style = strike)
            Text("${Fmt.date(f.date)} · ${f.sourceLabel}", fontSize = 11.sp, color = p.tertiary, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (f.isRetired) {
                Text(stringResource(R.string.memory_retiredBy, f.retiredBy ?: ""), fontSize = 11.sp, color = p.secondary)
            }
        }
    }
}

@Composable
fun FactSheet(state: AppState, req: SheetReq, binding: Fact?, onDismiss: () -> Unit, onRetired: () -> Unit) {
    val p = pal
    val scope = rememberCoroutineScope()
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val fact = req.fact
    var mode by remember(req) { mutableStateOf(req.kind) }
    val defaultReason = stringResource(R.string.fact_reasonDefault)
    var reason by remember(req) { mutableStateOf(if (req.kind == "retire") defaultReason else "") }
    var value by remember(req) { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val retiredToast = stringResource(R.string.fact_retiredToast, fact.value)
    val pinnedToast = stringResource(if (fact.isPinned) R.string.fact_unpinnedToast else R.string.fact_pinnedToast)
    val correctedToast = stringResource(R.string.fact_correctedToast)
    val restoredToast = stringResource(R.string.fact_restoredToast, fact.value)

    fun switchTo(m: String) {
        reason = if (m == "retire") defaultReason else ""
        mode = m
    }

    fun submit(op: suspend () -> Unit, toast: String, after: () -> Unit = {}) {
        busy = true
        error = null
        scope.launch {
            val err = state.write(toast, op)
            busy = false
            if (err == null) {
                after()
                onDismiss()
            } else {
                error = err
            }
        }
    }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState, containerColor = p.bg) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(bottom = 24.dp)
                .imePadding(),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            val title = when (mode) {
                "retire" -> stringResource(R.string.fact_retireTitle)
                "pin" -> stringResource(if (fact.isPinned) R.string.fact_unpin else R.string.fact_pin)
                "correct" -> stringResource(R.string.fact_correct)
                else -> stringResource(R.string.fact_detail)
            }
            Text(title, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = p.text, modifier = Modifier.align(Alignment.CenterHorizontally))

            CCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(fact.value, fontSize = 24.sp, fontWeight = FontWeight.Bold, style = if (fact.isRetired) strike else TextStyle.Default, modifier = Modifier.weight(1f))
                    when {
                        fact.isRetired -> Pill(stringResource(R.string.fact_retired), p.secondary)
                        fact.id == binding?.id -> Pill(stringResource(R.string.fact_binding), p.binding)
                        fact.supersededBy != null && fact.type != "SUPERSEDED" -> Pill(stringResource(R.string.fact_stillActive), p.amber, dot = true)
                    }
                }
                Text("${fact.sourceLabel} · ${Fmt.date(fact.date)}", fontSize = 12.sp, fontFamily = FontFamily.Monospace, color = p.secondary)
                fact.quote?.let { QuoteBlock(it, color = p.secondary, collapsible = mode == "retire") }
                val rr = fact.retiredReason
                if (fact.isRetired && rr != null) {
                    Text(stringResource(R.string.fact_retiredReason, fact.retiredBy ?: "", rr), fontSize = 13.sp, color = p.secondary)
                }
            }

            when (mode) {
                "retire" -> {
                    OutlinedTextField(
                        value = reason,
                        onValueChange = { reason = it },
                        label = { Text(stringResource(R.string.fact_reason)) },
                        placeholder = { Text(stringResource(R.string.fact_reasonPlaceholder)) },
                        modifier = Modifier.fillMaxWidth().testTag("retire_reason"),
                        maxLines = 3,
                    )
                    if (binding != null && binding.id != fact.id) {
                        SectionHeader(stringResource(R.string.fact_after))
                        CCard {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(stringResource(R.string.fact_nextAnswer), color = p.secondary, fontSize = 14.sp, modifier = Modifier.weight(1f))
                                Text("${binding.value} · ${binding.sourceLabel}", color = p.binding, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                            }
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(fact.value, color = p.secondary, style = strike, fontSize = 14.sp, modifier = Modifier.weight(1f))
                                Text(stringResource(R.string.fact_retiredByToday, state.actorName), color = p.secondary, fontSize = 12.sp)
                            }
                        }
                    }
                    Text(stringResource(R.string.fact_auditNote), fontSize = 12.sp, color = p.secondary)
                }
                "pin" -> OutlinedTextField(
                    value = reason,
                    onValueChange = { reason = it },
                    label = { Text(stringResource(R.string.fact_reason)) },
                    placeholder = { Text(stringResource(R.string.fact_pinPlaceholder)) },
                    modifier = Modifier.fillMaxWidth(),
                )
                "correct" -> {
                    OutlinedTextField(
                        value = value,
                        onValueChange = { value = it },
                        label = { Text(stringResource(R.string.fact_newValue)) },
                        placeholder = { Text(fact.value) },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = reason,
                        onValueChange = { reason = it },
                        label = { Text(stringResource(R.string.fact_reason)) },
                        placeholder = { Text(stringResource(R.string.fact_correctPlaceholder)) },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                else -> {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (fact.isRetired) {
                            FilledTonalButton(onClick = {
                                submit({ Api.send("POST", "/facts/${fact.id}/restore", body("actor" to state.actorName)) }, restoredToast)
                            }, enabled = !busy) { Text(stringResource(R.string.fact_restore)) }
                        } else {
                            FilledTonalButton(onClick = { switchTo("retire") }) { Text(stringResource(R.string.fact_retire)) }
                            FilledTonalButton(onClick = { switchTo("pin") }) { Text(stringResource(if (fact.isPinned) R.string.fact_unpin else R.string.fact_pin)) }
                            FilledTonalButton(onClick = { switchTo("correct") }) { Text(stringResource(R.string.fact_correct)) }
                        }
                    }
                    CCard {
                        DetailRow(stringResource(R.string.fact_type), fact.type ?: "")
                        DetailRow("ID", fact.id)
                        fact.confidence?.let { DetailRow(stringResource(R.string.fact_confidence), String.format(java.util.Locale.US, "%.2f", it)) }
                        DetailRow(stringResource(R.string.fact_document), fact.docId ?: "")
                    }
                }
            }

            error?.let { ErrorBanner(it) }

            if (mode != "detail") {
                val ok = !busy && reason.isNotBlank() && (mode != "correct" || value.isNotBlank())
                Button(
                    onClick = {
                        val r = reason.trim()
                        when (mode) {
                            "retire" -> submit(
                                { Api.send("POST", "/facts/${fact.id}/retire", body("reason" to r, "actor" to state.actorName)) },
                                retiredToast,
                                onRetired,
                            )
                            "pin" -> submit(
                                {
                                    val path = if (fact.isPinned) "unpin" else "pin"
                                    Api.send("POST", "/facts/${fact.id}/$path", body("reason" to r, "actor" to state.actorName))
                                },
                                pinnedToast,
                            )
                            else -> submit(
                                { Api.send("PATCH", "/facts/${fact.id}", body("value" to value.trim(), "reason" to r, "actor" to state.actorName)) },
                                correctedToast,
                            )
                        }
                    },
                    enabled = ok,
                    shape = RoundedCornerShape(14.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = if (mode == "retire") p.red else p.binding, contentColor = Color.White),
                    modifier = Modifier.fillMaxWidth().height(52.dp).testTag("confirm_action"),
                ) {
                    if (busy) {
                        CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
                    } else {
                        val label = when (mode) {
                            "retire" -> stringResource(R.string.fact_confirmRetire)
                            "pin" -> stringResource(if (fact.isPinned) R.string.fact_unpin else R.string.fact_pin)
                            else -> stringResource(R.string.fact_saveCorrection)
                        }
                        Text(label, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                    }
                }
            }
        }
    }
}

@Composable
private fun DetailRow(label: String, value: String) {
    Row {
        Text(label, fontSize = 14.sp, color = pal.secondary, modifier = Modifier.width(110.dp))
        Text(value, fontSize = 14.sp, color = pal.text)
    }
}
