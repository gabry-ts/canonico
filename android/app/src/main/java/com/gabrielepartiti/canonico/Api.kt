package com.gabrielepartiti.canonico

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNamingStrategy
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

@Serializable
data class Fact(
    val id: String,
    val projectId: String? = null,
    val topic: String? = null,
    val value: String = "",
    val type: String? = null,
    val status: String? = null,
    val docId: String? = null,
    val quote: String? = null,
    val date: String? = null,
    val supersedes: String? = null,
    val supersededBy: String? = null,
    val confidence: Double? = null,
    val retiredBy: String? = null,
    val retiredAt: String? = null,
    val retiredReason: String? = null,
    val pinned: Boolean? = null,
    val docTitle: String? = null,
) {
    val isRetired: Boolean get() = status == "retired"
    val isPinned: Boolean get() = pinned == true
    val sourceLabel: String
        get() {
            val d = docId ?: return ""
            return d.substringAfterLast('/').replace("-", " ").replace("meeting 00", "meeting ")
        }
}

@Serializable
data class Topic(val id: String, val projectId: String? = null, val label: String = "", val factIds: List<String>? = null)

@Serializable
data class TopicChain(val topic: Topic, val facts: List<Fact> = emptyList(), val changes: Int? = null)

@Serializable
data class AskResponse(
    val question: String? = null,
    val status: String = "",
    val answer: String? = null,
    val binding: Fact? = null,
    val superseded: List<Fact>? = null,
    val conflicts: List<Fact>? = null,
    val changedBecause: String? = null,
    val answerId: String? = null,
)

@Serializable
data class AuditEvent(
    val id: String,
    val at: String = "",
    val actor: String? = null,
    val action: String? = null,
    val factId: String? = null,
    val reason: String? = null,
    val summary: String? = null,
    val projectId: String? = null,
)

@Serializable
data class MaintenanceItem(
    val id: String,
    val fact: Fact? = null,
    val reason: String? = null,
    val detail: String? = null,
    val proposedAction: String? = null,
    val status: String? = null,
)

@Serializable
data class Conflict(
    val id: String,
    val topic: String? = null,
    val status: String? = null,
    val summary: String? = null,
    val facts: List<Fact> = emptyList(),
)

@Serializable
data class OpenQuestion(
    val id: String,
    val topic: String? = null,
    val question: String = "",
    val status: String? = null,
    val docId: String? = null,
    val openedAt: String? = null,
)

@Serializable
data class Member(val id: String = "", val name: String = "", val email: String? = null, val orgRole: String? = null)

@Serializable
data class Me(val member: Member? = null, val role: String? = null, val name: String? = null, val title: String? = null)

@Serializable
data class LoginResponse(val member: Member? = null, val token: String? = null)

@Serializable
data class Project(val id: String, val name: String = "", val description: String? = null)

@Serializable
data class ProjectList(val items: List<Project> = emptyList())

class ApiError(val status: Int, override val message: String) : Exception(message)

@OptIn(ExperimentalSerializationApi::class)
val json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
    isLenient = true
    namingStrategy = JsonNamingStrategy.SnakeCase
}

fun body(vararg pairs: Pair<String, Any?>): JsonObject = buildJsonObject {
    for ((k, v) in pairs) {
        when (v) {
            null -> {}
            is String -> put(k, JsonPrimitive(v))
            is Boolean -> put(k, JsonPrimitive(v))
            is Number -> put(k, JsonPrimitive(v))
            else -> put(k, JsonPrimitive(v.toString()))
        }
    }
}

object Api {
    val BASE: String = BuildConfig.API_BASE
    var token: String? = null
    var lang: String = "en"
    var networkError: String = "Cannot reach the server."
    var onUnauthorized: (() -> Unit)? = null

    private val jsonType = "application/json".toMediaType()
    private val client = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .callTimeout(90, TimeUnit.SECONDS)
        .build()

    suspend fun raw(method: String, path: String, query: Map<String, String?> = emptyMap(), body: JsonObject? = null): String {
        val result = withContext(Dispatchers.IO) {
            val ub = (BASE + path).toHttpUrl().newBuilder()
            for ((k, v) in query) if (v != null) ub.addQueryParameter(k, v)
            val rb = Request.Builder().url(ub.build())
                .header("Accept", "application/json")
                .header("Accept-Language", lang)
            token?.let { rb.header("Authorization", "Bearer $it") }
            val reqBody = when {
                body != null -> body.toString().toRequestBody(jsonType)
                method != "GET" -> "{}".toRequestBody(jsonType)
                else -> null
            }
            rb.method(method, reqBody)
            val resp = try {
                client.newCall(rb.build()).execute()
            } catch (e: IOException) {
                throw ApiError(0, networkError)
            }
            resp.use { r ->
                val text = r.body?.string() ?: ""
                if (r.isSuccessful) {
                    Result.success(text)
                } else {
                    val msg = runCatching {
                        val o = json.parseToJsonElement(text).jsonObject
                        (o["message"] as? JsonPrimitive)?.contentOrNull ?: (o["detail"] as? JsonPrimitive)?.contentOrNull
                    }.getOrNull() ?: "HTTP ${r.code}"
                    Result.failure(ApiError(r.code, msg))
                }
            }
        }
        result.exceptionOrNull()?.let { e ->
            if (e is ApiError && e.status == 401 && !path.startsWith("/auth/")) onUnauthorized?.invoke()
            throw e
        }
        return result.getOrThrow()
    }

    suspend inline fun <reified T> get(path: String, query: Map<String, String?> = emptyMap()): T =
        json.decodeFromString(raw("GET", path, query))

    suspend inline fun <reified T> post(path: String, body: JsonObject? = null): T =
        json.decodeFromString(raw("POST", path, body = body))

    suspend fun send(method: String, path: String, body: JsonObject? = null) {
        raw(method, path, body = body)
    }
}
