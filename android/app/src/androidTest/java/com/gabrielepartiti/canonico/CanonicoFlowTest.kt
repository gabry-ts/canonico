package com.gabrielepartiti.canonico

import android.content.Context
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextReplacement
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * End-to-end tests against a local API started on the emulator host (http://10.0.2.2:8000).
 * They must never run against the live site: the debug build points at the local API only.
 */
@RunWith(AndroidJUnit4::class)
class CanonicoFlowTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private var scenario: ActivityScenario<MainActivity>? = null
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()

    @After
    fun tearDown() {
        scenario?.close()
    }

    private fun resetBackend() {
        val base = BuildConfig.API_BASE
        check(base.startsWith("http://10.0.2.2")) { "Tests must run against the local API, not $base" }
        val client = OkHttpClient()
        val media = "application/json".toMediaType()
        val login = client.newCall(
            Request.Builder().url("$base/auth/demo-login").post("{}".toRequestBody(media)).build(),
        ).execute().use { it.body!!.string() }
        val token = json.parseToJsonElement(login).jsonObject["token"]!!.jsonPrimitive.content
        client.newCall(
            Request.Builder().url("$base/demo/reset").header("Authorization", "Bearer $token")
                .post("{}".toRequestBody(media)).build(),
        ).execute().use { check(it.isSuccessful) { "demo reset failed: HTTP ${it.code}" } }
    }

    private fun launch(lang: String = "en") {
        instrumentation.targetContext.getSharedPreferences("canonico", Context.MODE_PRIVATE)
            .edit().clear().putString("lang", lang).commit()
        resetBackend()
        scenario = ActivityScenario.launch(MainActivity::class.java)
    }

    private fun exists(tag: String) =
        compose.onAllNodesWithTag(tag, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()

    private fun waitTag(tag: String, timeout: Long = 30_000) = compose.waitUntil(timeout) { exists(tag) }

    private fun waitText(text: String, timeout: Long = 30_000) = compose.waitUntil(timeout) {
        compose.onAllNodesWithText(text, substring = true, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()
    }

    private fun click(tag: String) {
        waitTag(tag)
        compose.onAllNodesWithTag(tag, useUnmergedTree = true).onFirst().performSemanticsAction(SemanticsActions.OnClick)
    }

    private fun shot(name: String) {
        compose.waitForIdle()
        val ui = instrumentation.uiAutomation
        ui.executeShellCommand("mkdir -p /data/local/tmp/canonico-shots").close()
        val pfd = ui.executeShellCommand("screencap -p /data/local/tmp/canonico-shots/$name.png")
        android.os.ParcelFileDescriptor.AutoCloseInputStream(pfd).use { it.readBytes() }
    }

    private fun loginAsDemo() {
        click("demo_login")
        waitTag("ask_input")
    }

    private fun ask(question: String) {
        compose.onNodeWithTag("ask_input", useUnmergedTree = true).performTextReplacement(question)
        click("ask_send")
    }

    @Test
    fun retireFlowChangesTheNextAnswer() {
        launch()
        shot("01-login")
        loginAsDemo()
        ask("How long does onboarding take?")
        waitTag("answer")
        waitText("Three to four weeks")
        shot("02-answer")

        click("open_topic")
        waitTag("retire_stale")
        shot("03-topic")

        click("retire_stale")
        waitTag("retire_reason")
        compose.onNodeWithTag("retire_reason", useUnmergedTree = true).performTextReplacement("Superseded by the final report")
        shot("04-retire-sheet")
        click("confirm_action")

        waitTag("ask_again")
        shot("05-retired")
        click("ask_again")

        waitTag("changed_because", timeout = 45_000)
        waitText("Three to four weeks")
        assertTrue(exists("changed_because"))
        assertTrue(!exists("error_banner"))
        shot("06-asked-again")
    }

    @Test
    fun tabsLoadWithoutErrors() {
        launch()
        loginAsDemo()

        click("tab_memory")
        waitTag("memory_screen")
        waitText("Onboarding time")
        assertTrue("memory shows an error", !exists("error_banner"))
        shot("10-memory")

        click("tab_review")
        waitTag("review_screen")
        compose.waitUntil(30_000) { !exists("error_banner") }
        shot("11-review")

        click("tab_activity")
        waitTag("activity_screen")
        compose.waitUntil(30_000) { !exists("error_banner") }
        shot("12-activity")

        click("tab_settings")
        waitTag("settings_screen")
        waitText("Giulia")
        assertTrue("settings shows an error", !exists("error_banner"))
        shot("13-settings")
    }

    @Test
    fun italianQuestionGetsABindingAnswer() {
        launch("it")
        loginAsDemo()
        ask("Quanto dura l'onboarding?")
        waitTag("answer")
        waitText("Vincolante")
        assertTrue(!exists("error_banner"))
        shot("20-italian")
    }
}
