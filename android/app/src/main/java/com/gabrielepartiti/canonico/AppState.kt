package com.gabrielepartiti.canonico

import android.app.Application
import android.content.Context
import android.content.res.Configuration
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.util.Locale

fun localized(base: Context, lang: String): Context {
    val locale = Locale(lang)
    Locale.setDefault(locale)
    val config = Configuration(base.resources.configuration)
    config.setLocale(locale)
    return base.createConfigurationContext(config)
}

sealed interface ChatItem {
    val key: Long

    data class Divider(override val key: Long, val text: String) : ChatItem
    data class Question(override val key: Long, val text: String) : ChatItem
    data class Answer(override val key: Long, val res: AskResponse) : ChatItem
    data class Pending(override val key: Long) : ChatItem
    data class Failure(override val key: Long, val message: String) : ChatItem
}

class AppState(app: Application) : AndroidViewModel(app) {
    private val prefs = app.getSharedPreferences("canonico", Context.MODE_PRIVATE)

    var loggedIn by mutableStateOf(false)
    var me by mutableStateOf<Me?>(null)
    var projects by mutableStateOf<List<Project>>(emptyList())
    var projectId by mutableStateOf(prefs.getString("projectId", null) ?: "proj-clearpath")
        private set
    var inboxCount by mutableIntStateOf(0)
    var memoryVersion by mutableIntStateOf(0)
    var tab by mutableIntStateOf(0)
    val topicStack = mutableStateListOf<String>()
    var toast by mutableStateOf<String?>(null)
    var theme by mutableStateOf(prefs.getString("theme", null) ?: "system")
        private set

    val chat = mutableStateListOf<ChatItem>()
    var askInput by mutableStateOf("")
    var askBusy by mutableStateOf(false)
    private var lastQuestion: String? = null
    private var todayShown = false
    private var nextKey = 0L

    val lang: String get() = if (prefs.getString("lang", null) == "it") "it" else "en"

    val actorName: String
        get() = me?.name ?: me?.member?.name?.substringBefore(' ')?.takeIf { it.isNotEmpty() } ?: "Giulia"

    val projectName: String get() = projects.firstOrNull { it.id == projectId }?.name ?: ""

    fun t(id: Int, vararg args: Any): String = localized(getApplication<Application>(), lang).resources.getString(id, *args)

    init {
        Api.token = prefs.getString("token", null)
        Api.lang = lang
        Api.onUnauthorized = {
            setToken(null)
            me = null
            loggedIn = false
        }
        loggedIn = Api.token != null
        if (loggedIn) loadMe()
    }

    private fun key(): Long = ++nextKey

    private fun setToken(t: String?) {
        Api.token = t
        prefs.edit().apply { if (t == null) remove("token") else putString("token", t) }.apply()
    }

    fun setLang(v: String) {
        prefs.edit().putString("lang", v).apply()
        Api.lang = lang
    }

    fun updateTheme(v: String) {
        theme = v
        prefs.edit().putString("theme", v).apply()
    }

    fun selectProject(id: String) {
        if (id == projectId) return
        projectId = id
        prefs.edit().putString("projectId", id).apply()
        chat.clear()
        todayShown = false
        memoryChanged()
    }

    suspend fun demoLogin() {
        val r: LoginResponse = Api.post("/auth/demo-login")
        setToken(r.token)
        didLogin()
    }

    suspend fun login(user: String, password: String) {
        val known = mapOf(
            "giulia" to "giulia.ferri@meridianlabs.org",
            "sara" to "sara.conti@meridianlabs.org",
            "luca" to "luca.bassi@meridianlabs.org",
        )
        val trimmed = user.trim().lowercase()
        val email = if (trimmed.contains("@")) trimmed else known[trimmed] ?: trimmed
        val r: LoginResponse = Api.post("/auth/login", body("email" to email, "password" to password))
        setToken(r.token)
        didLogin()
    }

    private fun didLogin() {
        loggedIn = true
        tab = 0
        loadMe()
    }

    fun loadMe() {
        viewModelScope.launch {
            me = runCatching { Api.get<Me>("/me") }.getOrNull()
            runCatching { Api.get<ProjectList>("/projects") }.getOrNull()?.let { list ->
                projects = list.items
                if (list.items.none { it.id == projectId }) list.items.firstOrNull()?.let { selectProject(it.id) }
            }
            refreshInbox()
        }
    }

    suspend fun refreshInbox() {
        val items = runCatching { Api.get<List<MaintenanceItem>>("/maintenance/queue", mapOf("project_id" to projectId)) }.getOrNull() ?: return
        inboxCount = items.count { it.status == null || it.status == "pending" }
    }

    fun memoryChanged() {
        memoryVersion++
        viewModelScope.launch { refreshInbox() }
    }

    fun show(message: String) {
        toast = message
    }

    fun openTopic(id: String) {
        topicStack.add(id)
    }

    fun ask(question: String? = null) {
        val q = (question ?: askInput).trim()
        if (q.isEmpty() || askBusy) return
        askBusy = true
        lastQuestion = q
        askInput = ""
        if (!todayShown) {
            todayShown = true
            chat.add(ChatItem.Divider(key(), t(R.string.ask_today)))
        }
        chat.add(ChatItem.Question(key(), q))
        val pk = key()
        chat.add(ChatItem.Pending(pk))
        viewModelScope.launch {
            val item: ChatItem = try {
                val res: AskResponse = Api.post(
                    "/ask",
                    body("question" to q, "project_id" to projectId, "include_plain_retrieval" to true, "locale" to lang),
                )
                ChatItem.Answer(key(), res)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                ChatItem.Failure(key(), e.message ?: "Error")
            }
            val i = chat.indexOfFirst { it.key == pk }
            if (i >= 0) chat[i] = item
            askBusy = false
        }
    }

    fun askAgain() {
        tab = 0
        topicStack.clear()
        ask(lastQuestion ?: t(R.string.ask_suggestion1))
    }

    fun clearChat() {
        chat.clear()
        todayShown = false
    }

    fun resetDemo() {
        viewModelScope.launch {
            try {
                Api.send("POST", "/demo/reset")
                clearChat()
                askInput = ""
                memoryChanged()
                show(t(R.string.settings_resetDone))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                show(e.message ?: "Error")
            }
        }
    }

    /** Runs a write call, then refreshes memory and shows [success]. Returns the error message, if any. */
    suspend fun write(success: String?, op: suspend () -> Unit): String? {
        return try {
            op()
            memoryChanged()
            if (success != null) show(success)
            null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            e.message ?: "Error"
        }
    }

    fun logout() {
        viewModelScope.launch {
            runCatching { Api.send("POST", "/auth/logout") }
            setToken(null)
            me = null
            clearChat()
            topicStack.clear()
            loggedIn = false
        }
    }
}
