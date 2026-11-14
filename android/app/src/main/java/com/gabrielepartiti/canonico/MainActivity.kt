package com.gabrielepartiti.canonico

import android.content.Context
import android.graphics.Color as AColor
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun attachBaseContext(newBase: Context) {
        val lang = newBase.getSharedPreferences("canonico", Context.MODE_PRIVATE).getString("lang", null) ?: "en"
        super.attachBaseContext(localized(newBase, if (lang == "it") "it" else "en"))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        Api.networkError = getString(R.string.error_network)
        setContent {
            val state: AppState = viewModel()
            val dark = when (state.theme) {
                "light" -> false
                "dark" -> true
                else -> isSystemInDarkTheme()
            }
            DisposableEffect(dark) {
                val style = if (dark) SystemBarStyle.dark(AColor.TRANSPARENT)
                else SystemBarStyle.light(AColor.TRANSPARENT, AColor.TRANSPARENT)
                enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
                onDispose {}
            }
            CanonicoTheme(dark) {
                Surface(Modifier.fillMaxSize(), color = pal.bg) {
                    if (state.loggedIn) {
                        RootTabs(state, onLang = { v ->
                            if (v != state.lang) {
                                state.setLang(v)
                                recreate()
                            }
                        })
                    } else {
                        LoginScreen(state)
                    }
                }
            }
        }
    }
}

private data class TabDef(val label: Int, val icon: ImageVector, val tag: String)

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun RootTabs(state: AppState, onLang: (String) -> Unit) {
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(state.toast) {
        val t = state.toast
        if (t != null) {
            snackbar.showSnackbar(t)
            state.toast = null
        }
    }
    val tabs = listOf(
        TabDef(R.string.tab_ask, Icons.Filled.Search, "tab_ask"),
        TabDef(R.string.tab_memory, Icons.AutoMirrored.Filled.List, "tab_memory"),
        TabDef(R.string.tab_review, Icons.Filled.Notifications, "tab_review"),
        TabDef(R.string.tab_activity, Icons.Filled.DateRange, "tab_activity"),
        TabDef(R.string.tab_settings, Icons.Filled.Person, "tab_settings"),
    )
    Scaffold(
        containerColor = pal.bg,
        snackbarHost = { SnackbarHost(snackbar) },
        bottomBar = {
            NavigationBar(containerColor = pal.card) {
                tabs.forEachIndexed { i, t ->
                    NavigationBarItem(
                        selected = state.tab == i,
                        onClick = {
                            state.topicStack.clear()
                            state.tab = i
                        },
                        icon = {
                            if (i == 2 && state.inboxCount > 0) {
                                BadgedBox(badge = { Badge { Text("${state.inboxCount}") } }) { Icon(t.icon, contentDescription = null) }
                            } else {
                                Icon(t.icon, contentDescription = null)
                            }
                        },
                        label = { Text(stringResource(t.label)) },
                        modifier = Modifier.testTag(t.tag),
                    )
                }
            }
        },
    ) { pad ->
        Box(
            Modifier
                .padding(pad)
                .consumeWindowInsets(pad)
                .fillMaxSize(),
        ) {
            val topic = state.topicStack.lastOrNull()
            if (topic != null) {
                BackHandler { state.topicStack.removeAt(state.topicStack.lastIndex) }
                TopicScreen(state, topic)
            } else {
                when (state.tab) {
                    0 -> AskScreen(state)
                    1 -> MemoryScreen(state)
                    2 -> ReviewScreen(state)
                    3 -> ActivityScreen(state)
                    else -> SettingsScreen(state, onLang)
                }
            }
        }
    }
}

@Composable
fun LoginScreen(state: AppState) {
    val p = pal
    val scope = rememberCoroutineScope()
    var user by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var showForm by remember { mutableStateOf(false) }

    fun go(op: suspend () -> Unit) {
        busy = true
        error = null
        scope.launch {
            try {
                op()
            } catch (e: Exception) {
                error = e.message
            }
            busy = false
        }
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(p.binding.copy(alpha = 0.14f), p.bg, p.bg))),
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .systemBarsPadding()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp),
        ) {
            Spacer(Modifier.height(56.dp))
            BrandMark(64.dp)
            Text(
                "Canonico",
                fontSize = 34.sp,
                fontWeight = FontWeight.Bold,
                color = p.text,
                modifier = Modifier.padding(top = 24.dp),
            )
            Text(
                stringResource(R.string.login_tagline),
                fontSize = 20.sp,
                color = p.secondary,
                modifier = Modifier.padding(top = 6.dp),
            )
            Column(Modifier.padding(top = 32.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Feature(Icons.Filled.CheckCircle, p.binding, stringResource(R.string.login_feature1))
                Feature(Icons.Filled.Info, p.secondary, stringResource(R.string.login_feature2))
                Feature(Icons.Filled.Refresh, p.amber, stringResource(R.string.login_feature3))
            }
            Button(
                onClick = { go { state.demoLogin() } },
                enabled = !busy,
                shape = RoundedCornerShape(16.dp),
                colors = ButtonDefaults.buttonColors(containerColor = p.binding, contentColor = Color.White),
                modifier = Modifier
                    .padding(top = 40.dp)
                    .fillMaxWidth()
                    .height(56.dp)
                    .testTag("demo_login"),
            ) {
                if (busy && !showForm) {
                    CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
                } else {
                    Icon(Icons.Filled.Person, contentDescription = null)
                }
                Spacer(Modifier.width(10.dp))
                Text(stringResource(R.string.login_demo), fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
            }
            TextButton(onClick = { showForm = !showForm }, modifier = Modifier.fillMaxWidth().padding(top = 6.dp)) {
                Text(stringResource(R.string.login_or), color = p.binding)
                Icon(Icons.Filled.KeyboardArrowDown, contentDescription = null, tint = p.binding)
            }
            AnimatedVisibility(showForm) {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedTextField(
                        value = user,
                        onValueChange = { user = it },
                        label = { Text(stringResource(R.string.login_username)) },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = password,
                        onValueChange = { password = it },
                        label = { Text(stringResource(R.string.login_password)) },
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Go),
                        keyboardActions = KeyboardActions(onGo = {
                            if (user.isNotBlank() && password.isNotBlank()) go { state.login(user, password) }
                        }),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedButton(
                        onClick = { go { state.login(user, password) } },
                        enabled = !busy && user.isNotBlank() && password.isNotBlank(),
                        shape = RoundedCornerShape(14.dp),
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                    ) { Text(stringResource(R.string.login_signin), fontWeight = FontWeight.SemiBold) }
                    Text(stringResource(R.string.login_hint), style = MaterialTheme.typography.bodySmall, color = p.secondary)
                }
            }
            error?.let {
                Spacer(Modifier.height(16.dp))
                ErrorBanner(it)
            }
            Spacer(Modifier.height(32.dp))
        }
    }
}

@Composable
private fun Feature(icon: ImageVector, color: Color, text: String) {
    Row(verticalAlignment = Alignment.Top) {
        Icon(icon, contentDescription = null, tint = color, modifier = Modifier.size(22.dp))
        Spacer(Modifier.width(14.dp))
        Text(text, style = MaterialTheme.typography.bodyMedium, color = pal.text.copy(alpha = 0.85f))
    }
}
