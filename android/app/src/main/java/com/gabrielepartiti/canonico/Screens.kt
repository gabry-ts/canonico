@file:OptIn(ExperimentalMaterial3Api::class)

package com.gabrielepartiti.canonico

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

@Composable
fun ScreenBar(title: String, onRefresh: (() -> Unit)? = null) {
    TopAppBar(
        windowInsets = WindowInsets(0),
        colors = TopAppBarDefaults.topAppBarColors(containerColor = pal.bg),
        title = { Text(title, fontWeight = FontWeight.Bold, fontSize = 28.sp) },
        actions = {
            if (onRefresh != null) {
                IconButton(onClick = onRefresh) { Icon(Icons.Filled.Refresh, contentDescription = stringResource(R.string.common_refresh)) }
            }
        },
    )
}

private suspend fun <T> loadInto(setError: (String?) -> Unit, op: suspend () -> T): T? {
    return try {
        val r = op()
        setError(null)
        r
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        setError(e.message ?: "Error")
        null
    }
}

// MARK: Memory

@Composable
fun MemoryScreen(state: AppState) {
    val p = pal
    var topics by remember { mutableStateOf<List<Topic>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var search by remember { mutableStateOf("") }
    var reload by remember { mutableIntStateOf(0) }

    LaunchedEffect(state.projectId, state.memoryVersion, reload) {
        loadInto({ error = it }) { Api.get<List<Topic>>("/topics", mapOf("project_id" to state.projectId)) }?.let { topics = it }
    }

    val s = search.trim().lowercase()
    val filtered = (topics ?: emptyList()).filter { s.isEmpty() || it.label.lowercase().contains(s) || it.id.contains(s) }

    Column(Modifier.fillMaxSize().background(p.bg).testTag("memory_screen")) {
        ScreenBar(stringResource(R.string.tab_memory)) { reload++ }
        OutlinedTextField(
            value = search,
            onValueChange = { search = it },
            placeholder = { Text(stringResource(R.string.memory_search)) },
            leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
            singleLine = true,
            shape = RoundedCornerShape(14.dp),
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        )
        LazyColumn(
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            error?.let { e -> item { ErrorBanner(e) { reload++ } } }
            if (topics == null && error == null) item { Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() } }
            if (topics != null && filtered.isEmpty()) item { EmptyState(stringResource(R.string.memory_empty)) }
            items(filtered, key = { it.id }) { t ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(14.dp))
                        .background(p.card)
                        .clickable { state.openTopic(t.id) }
                        .padding(horizontal = 14.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        Modifier.size(32.dp).clip(RoundedCornerShape(8.dp)).background(p.bindingSoft),
                        contentAlignment = Alignment.Center,
                    ) { Icon(Icons.AutoMirrored.Filled.List, contentDescription = null, tint = p.binding, modifier = Modifier.size(18.dp)) }
                    Spacer(Modifier.width(12.dp))
                    Text(t.label, fontSize = 16.sp, color = p.text, modifier = Modifier.weight(1f))
                    Text(
                        "${t.factIds?.size ?: 0}",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = p.secondary,
                        modifier = Modifier.clip(CircleShape).background(p.bubble).padding(horizontal = 8.dp, vertical = 2.dp),
                    )
                    Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = p.tertiary)
                }
            }
        }
    }
}

// MARK: Review

@Composable
fun ReviewScreen(state: AppState) {
    val p = pal
    val scope = rememberCoroutineScope()
    var segment by remember { mutableIntStateOf(0) }
    var queue by remember { mutableStateOf<List<MaintenanceItem>>(emptyList()) }
    var conflicts by remember { mutableStateOf<List<Conflict>>(emptyList()) }
    var questions by remember { mutableStateOf<List<OpenQuestion>>(emptyList()) }
    var loaded by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    var resolving by remember { mutableStateOf<Conflict?>(null) }
    var closing by remember { mutableStateOf<OpenQuestion?>(null) }

    LaunchedEffect(state.projectId, state.memoryVersion, reload) {
        val q = mapOf("project_id" to state.projectId)
        loadInto({ error = it }) {
            queue = Api.get("/maintenance/queue", q)
            conflicts = Api.get("/conflicts", q)
            questions = Api.get("/open-questions", q)
            state.inboxCount = queue.count { it.status == null || it.status == "pending" }
        }
        loaded = true
    }

    val approved = stringResource(R.string.review_approved)
    val kept = stringResource(R.string.review_kept)
    fun decide(item: MaintenanceItem, action: String) {
        scope.launch {
            val err = state.write(if (action == "approve") approved else kept) {
                Api.send("POST", "/maintenance/${item.id}/$action", body("actor" to state.actorName))
            }
            if (err != null) state.show(err)
        }
    }

    val pending = queue.filter { it.status == null || it.status == "pending" }
    val openConflicts = conflicts.filter { it.status == null || it.status == "open" }
    val openQuestions = questions.filter { it.status == null || it.status == "open" }

    Column(Modifier.fillMaxSize().background(p.bg).testTag("review_screen")) {
        ScreenBar(stringResource(R.string.tab_review)) { reload++ }
        val labels = listOf(R.string.review_maintenance, R.string.review_conflicts, R.string.review_questions)
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
            labels.forEachIndexed { i, l ->
                SegmentedButton(
                    selected = segment == i,
                    onClick = { segment = i },
                    shape = SegmentedButtonDefaults.itemShape(index = i, count = labels.size),
                ) { Text(stringResource(l), maxLines = 1) }
            }
        }
        LazyColumn(
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            error?.let { e -> item { ErrorBanner(e) { reload++ } } }
            if (!loaded) item { Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() } }
            when (segment) {
                0 -> {
                    if (loaded && pending.isEmpty()) item { EmptyState(stringResource(R.string.review_emptyStale)) }
                    items(pending, key = { it.id }) { item ->
                        CCard {
                            item.fact?.let { f ->
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(f.value, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                                    item.proposedAction?.let { Pill(it, p.amber, dot = true) }
                                }
                                Text("${f.sourceLabel} · ${Fmt.date(f.date)}", fontSize = 12.sp, fontFamily = FontFamily.Monospace, color = p.secondary)
                            }
                            item.detail?.let { Text(it, fontSize = 13.sp, color = p.secondary) }
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                                Button(onClick = { decide(item, "approve") }) { Text(stringResource(R.string.review_approve)) }
                                OutlinedButton(onClick = { decide(item, "dismiss") }) { Text(stringResource(R.string.review_keep)) }
                                Spacer(Modifier.weight(1f))
                                item.fact?.topic?.let { topic ->
                                    IconButton(onClick = { state.openTopic(topic) }) {
                                        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = stringResource(R.string.review_open))
                                    }
                                }
                            }
                        }
                    }
                }
                1 -> {
                    if (loaded && openConflicts.isEmpty()) item { EmptyState(stringResource(R.string.review_emptyConflicts)) }
                    items(openConflicts, key = { it.id }) { c ->
                        CCard {
                            Text(c.topic ?: "", fontSize = 12.sp, fontFamily = FontFamily.Monospace, color = p.secondary)
                            c.summary?.let { Text(it, fontSize = 14.sp) }
                            c.facts.forEach { f ->
                                Text("• ${f.value} · ${f.sourceLabel} · ${Fmt.date(f.date)}", fontSize = 12.sp, color = p.text)
                            }
                            OutlinedButton(onClick = { resolving = c }) { Text(stringResource(R.string.review_resolve)) }
                        }
                    }
                }
                else -> {
                    if (loaded && openQuestions.isEmpty()) item { EmptyState(stringResource(R.string.review_emptyQuestions)) }
                    items(openQuestions, key = { it.id }) { q ->
                        CCard {
                            Text(q.question, fontSize = 15.sp)
                            Text("${q.docId ?: ""} · ${Fmt.date(q.openedAt)}", fontSize = 11.sp, fontFamily = FontFamily.Monospace, color = p.secondary)
                            OutlinedButton(onClick = { closing = q }) { Text(stringResource(R.string.review_close)) }
                        }
                    }
                }
            }
        }
    }

    resolving?.let { c ->
        var winner by remember(c.id) { mutableStateOf(c.facts.lastOrNull()?.id ?: "") }
        var reason by remember(c.id) { mutableStateOf("") }
        var err by remember(c.id) { mutableStateOf<String?>(null) }
        AlertDialog(
            onDismissRequest = { resolving = null },
            title = { Text(stringResource(R.string.review_winner)) },
            text = {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    c.facts.forEach { f ->
                        Row(
                            Modifier.fillMaxWidth().selectable(selected = winner == f.id, onClick = { winner = f.id }).padding(vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            RadioButton(selected = winner == f.id, onClick = { winner = f.id })
                            Column {
                                Text(f.value, fontWeight = FontWeight.Medium)
                                Text("${f.sourceLabel} · ${Fmt.date(f.date)}", fontSize = 12.sp, color = p.secondary)
                            }
                        }
                    }
                    OutlinedTextField(
                        value = reason,
                        onValueChange = { reason = it },
                        label = { Text(stringResource(R.string.fact_reason)) },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    err?.let { ErrorBanner(it) }
                }
            },
            confirmButton = {
                TextButton(enabled = winner.isNotEmpty() && reason.isNotBlank(), onClick = {
                    scope.launch {
                        err = state.write(null) {
                            Api.send("POST", "/conflicts/${c.id}/resolve", body("winning_fact_id" to winner, "reason" to reason.trim(), "actor" to state.actorName))
                        }
                        if (err == null) resolving = null
                    }
                }) { Text(stringResource(R.string.common_confirm)) }
            },
            dismissButton = { TextButton(onClick = { resolving = null }) { Text(stringResource(R.string.common_cancel)) } },
        )
    }

    closing?.let { q ->
        var note by remember(q.id) { mutableStateOf("") }
        var err by remember(q.id) { mutableStateOf<String?>(null) }
        AlertDialog(
            onDismissRequest = { closing = null },
            title = { Text(stringResource(R.string.review_close)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(q.question)
                    OutlinedTextField(
                        value = note,
                        onValueChange = { note = it },
                        label = { Text(stringResource(R.string.review_note)) },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    err?.let { ErrorBanner(it) }
                }
            },
            confirmButton = {
                TextButton(enabled = note.isNotBlank(), onClick = {
                    scope.launch {
                        err = state.write(null) {
                            Api.send("POST", "/open-questions/${q.id}/close", body("note" to note.trim(), "actor" to state.actorName))
                        }
                        if (err == null) closing = null
                    }
                }) { Text(stringResource(R.string.common_confirm)) }
            },
            dismissButton = { TextButton(onClick = { closing = null }) { Text(stringResource(R.string.common_cancel)) } },
        )
    }
}

// MARK: Activity

private val undoable = setOf("retire", "restore", "pin", "unpin", "correct", "patch", "resolve", "supersede", "maintenance_approve")

@Composable
fun ActivityScreen(state: AppState) {
    val p = pal
    val scope = rememberCoroutineScope()
    var events by remember { mutableStateOf<List<AuditEvent>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    var undoing by remember { mutableStateOf<AuditEvent?>(null) }

    LaunchedEffect(state.projectId, state.memoryVersion, reload) {
        loadInto({ error = it }) { Api.get<List<AuditEvent>>("/audit", mapOf("limit" to "100")) }
            ?.let { list -> events = list.sortedByDescending { it.at } }
    }

    Column(Modifier.fillMaxSize().background(p.bg).testTag("activity_screen")) {
        ScreenBar(stringResource(R.string.tab_activity)) { reload++ }
        LazyColumn(
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            error?.let { e -> item { ErrorBanner(e) { reload++ } } }
            val list = events
            if (list == null && error == null) item { Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() } }
            if (list != null && list.isEmpty()) item { EmptyState(stringResource(R.string.activity_empty)) }
            items(list ?: emptyList(), key = { it.id }) { e ->
                val color = if (e.action == "retire") p.amber else p.binding
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(p.card).padding(12.dp),
                    verticalAlignment = Alignment.Top,
                ) {
                    Box(Modifier.size(10.dp).offset(y = 5.dp).clip(CircleShape).background(color))
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Row(verticalAlignment = Alignment.Top) {
                            Text(e.summary ?: e.action ?: "", fontSize = 14.sp, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
                            e.action?.let {
                                Spacer(Modifier.width(6.dp))
                                Pill(it, color)
                            }
                        }
                        val r = e.reason
                        if (r != null && r != e.summary) Text(r, fontSize = 13.sp, color = p.secondary)
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("${e.actor ?: ""} · ${Fmt.timestamp(e.at)}", fontSize = 11.sp, color = p.tertiary, modifier = Modifier.weight(1f))
                            if (e.action?.let { it in undoable } == true) {
                                TextButton(onClick = { undoing = e }, contentPadding = PaddingValues(horizontal = 8.dp)) {
                                    Text(stringResource(R.string.activity_undo), color = p.amber, fontSize = 13.sp)
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    val undone = stringResource(R.string.activity_undone)
    val undoReason = stringResource(R.string.activity_undoReason)
    undoing?.let { e ->
        AlertDialog(
            onDismissRequest = { undoing = null },
            title = { Text(stringResource(R.string.activity_undoConfirm)) },
            text = { Text(e.summary ?: "") },
            confirmButton = {
                TextButton(onClick = {
                    undoing = null
                    scope.launch {
                        val err = state.write(undone) {
                            Api.send("POST", "/audit/${e.id}/undo", body("actor" to state.actorName, "reason" to undoReason))
                        }
                        if (err != null) state.show(err)
                    }
                }) { Text(stringResource(R.string.activity_undo), color = p.red) }
            },
            dismissButton = { TextButton(onClick = { undoing = null }) { Text(stringResource(R.string.common_cancel)) } },
        )
    }
}

// MARK: Settings

@Composable
fun SettingsScreen(state: AppState, onLang: (String) -> Unit) {
    val p = pal
    var confirmReset by remember { mutableStateOf(false) }
    val me = state.me
    val name = me?.member?.name ?: me?.name ?: "—"

    Column(
        Modifier
            .fillMaxSize()
            .background(p.bg)
            .testTag("settings_screen"),
    ) {
        ScreenBar(stringResource(R.string.tab_settings))
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            SectionHeader(stringResource(R.string.settings_account))
            CCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(44.dp).clip(CircleShape).background(p.bindingSoft), contentAlignment = Alignment.Center) {
                        Text(name.take(1), fontWeight = FontWeight.SemiBold, fontSize = 18.sp, color = p.binding)
                    }
                    Spacer(Modifier.width(12.dp))
                    Column {
                        Text(name, fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
                        val sub = listOfNotNull(me?.title, me?.role).joinToString(" · ")
                        if (sub.isNotEmpty()) Text(sub, fontSize = 13.sp, color = p.secondary)
                        me?.member?.email?.let { Text(it, fontSize = 12.sp, color = p.secondary) }
                    }
                }
            }

            if (state.projects.isNotEmpty()) {
                SectionHeader(stringResource(R.string.settings_project))
                CCard {
                    state.projects.forEach { pr ->
                        ChoiceRow(pr.name, state.projectId == pr.id) { state.selectProject(pr.id) }
                    }
                }
            }

            SectionHeader(stringResource(R.string.settings_language))
            CCard {
                ChoiceRow("English", state.lang == "en", Modifier.testTag("lang_en")) { onLang("en") }
                ChoiceRow("Italiano", state.lang == "it", Modifier.testTag("lang_it")) { onLang("it") }
            }

            SectionHeader(stringResource(R.string.settings_theme))
            CCard {
                ChoiceRow(stringResource(R.string.settings_system), state.theme == "system") { state.updateTheme("system") }
                ChoiceRow(stringResource(R.string.settings_light), state.theme == "light") { state.updateTheme("light") }
                ChoiceRow(stringResource(R.string.settings_dark), state.theme == "dark") { state.updateTheme("dark") }
            }

            CCard {
                Text(
                    stringResource(R.string.settings_reset),
                    color = p.binding,
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier.fillMaxWidth().clickable { confirmReset = true }.padding(vertical = 4.dp),
                )
            }
            Text(stringResource(R.string.settings_resetFooter), fontSize = 12.sp, color = p.secondary, modifier = Modifier.padding(horizontal = 4.dp))

            CCard {
                Text(
                    stringResource(R.string.settings_logout),
                    color = p.red,
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier.fillMaxWidth().clickable { state.logout() }.padding(vertical = 4.dp).testTag("logout"),
                )
            }
            Text(
                "${Api.BASE} · v${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})",
                fontSize = 11.sp,
                color = p.tertiary,
                modifier = Modifier.padding(horizontal = 4.dp),
            )
        }
    }

    if (confirmReset) {
        AlertDialog(
            onDismissRequest = { confirmReset = false },
            text = { Text(stringResource(R.string.settings_resetConfirm)) },
            confirmButton = {
                TextButton(onClick = {
                    confirmReset = false
                    state.resetDemo()
                }) { Text(stringResource(R.string.settings_reset), color = p.red) }
            },
            dismissButton = { TextButton(onClick = { confirmReset = false }) { Text(stringResource(R.string.common_cancel)) } },
        )
    }
}

@Composable
private fun ChoiceRow(label: String, selected: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Row(
        modifier.fillMaxWidth().selectable(selected = selected, onClick = onClick).padding(vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RadioButton(selected = selected, onClick = onClick)
        Spacer(Modifier.width(4.dp))
        Text(label, fontSize = 16.sp, color = pal.text)
    }
}
