package com.gunakarna.jazzrecovery

import android.Manifest
import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Shader
import android.graphics.LinearGradient
import android.graphics.Path
import android.graphics.Paint
import android.graphics.Canvas
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import android.location.LocationManager
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Jazz Recovery's native UI. All recovery actions continue to use the existing
 * device ID, Android Keystore token, server preference, account re-pair flow and foreground agent.
 */
class MainActivity : Activity() {
    private val prefs by lazy { getSharedPreferences("jazz_recovery_standalone", Context.MODE_PRIVATE) }
    private lateinit var status: TextView
    private lateinit var server: EditText
    private lateinit var tokenDisplay: EditText
    private lateinit var content: LinearLayout
    private lateinit var bottomNav: LinearLayout
    private var currentScreen = Screen.HOME
    private var deviceId: String = ""

    private enum class Screen { HOME, FIND_PHONE, SUPPORT, URL_TOKENS, PERMISSIONS, CODES, LOCATION, READINESS, BLUETOOTH, CAMERA }
    private data class Feature(val icon: String, val title: String, val subtitle: String, val action: () -> Unit)

    private val navy = Color.rgb(5, 10, 27)
    private val panel = Color.rgb(11, 20, 43)
    private val panelAlt = Color.rgb(14, 24, 51)
    private val cyan = Color.rgb(54, 225, 255)
    private val blue = Color.rgb(58, 119, 255)
    private val purple = Color.rgb(153, 82, 255)
    private val muted = Color.rgb(153, 174, 207)
    private val white = Color.rgb(245, 249, 255)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        deviceId = prefs.getString("device_id", null) ?: ("jazz-recovery-" + UUID.randomUUID()).also {
            prefs.edit().putString("device_id", it).apply()
        }
        window.statusBarColor = navy
        window.navigationBarColor = navy
        if (Build.VERSION.SDK_INT >= 29) {
            window.isNavigationBarContrastEnforced = false
            window.isStatusBarContrastEnforced = false
        }
        render(currentScreen)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putString("jazz_screen", currentScreen.name)
        super.onSaveInstanceState(outState)
    }

    override fun onRestoreInstanceState(savedInstanceState: Bundle) {
        super.onRestoreInstanceState(savedInstanceState)
        currentScreen = runCatching { Screen.valueOf(savedInstanceState.getString("jazz_screen", "HOME")) }.getOrDefault(Screen.HOME)
        render(currentScreen)
    }

    override fun onBackPressed() {
        if (currentScreen != Screen.HOME) render(Screen.HOME) else super.onBackPressed()
    }

    private fun render(screen: Screen) {
        currentScreen = screen
        status = TextView(this)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(navy)
            fitsSystemWindows = true
        }
        content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(18), dp(18), dp(22))
        }
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            clipToPadding = false
            addView(content, FrameLayout.LayoutParams(-1, -2))
        }
        root.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        bottomNav = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(dp(8), dp(7), dp(8), dp(7))
            background = shape(panel, 0, Color.TRANSPARENT, 0, topOnly = true)
        }
        root.addView(bottomNav, LinearLayout.LayoutParams(-1, dp(66)))
        setContentView(root)

        when (screen) {
            Screen.HOME -> home()
            Screen.FIND_PHONE -> findPhone()
            Screen.SUPPORT -> support()
            Screen.URL_TOKENS -> urlTokens()
            Screen.PERMISSIONS -> permissions()
            Screen.CODES -> codes()
            Screen.LOCATION -> location()
            Screen.READINESS -> readiness()
            Screen.BLUETOOTH -> bluetooth()
            Screen.CAMERA -> camera()
        }
        buildBottomNav()
    }

    private fun home() {
        brandHeader()
        val hero = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(12), dp(24), dp(12), dp(20))
            background = shape(panelAlt, 22, blue, 1, glow = true)
        }
        val emblem = ShieldEmblemView()
        hero.addView(emblem, LinearLayout.LayoutParams(dp(112), dp(112)))
        addText(hero, "YOUR DEVICE • YOUR DATA • YOUR CONTROL", 11f, cyan, true, Gravity.CENTER, top = 17, bottom = 2)
        content.addView(hero, marginParams(bottom = 18))
        addText(content, "Recovery tools", 20f, white, true, top = 0, bottom = 4)
        addText(content, "Quick access to your device's existing security features.", 13f, muted, false, bottom = 12)
        val gridRows = listOf(
            listOf(Feature("⌘", "URL Tokens", "View & Manage") { render(Screen.URL_TOKENS) },
                Feature("◈", "Permissions", "Grant & Control") { render(Screen.PERMISSIONS) }),
            listOf(Feature("▦", "Generate Codes", "Security Codes") { render(Screen.CODES) },
                Feature("⌖", "Location", "View Location") { render(Screen.LOCATION) }),
            listOf(Feature("◉", "Recovery", "Readiness") { render(Screen.READINESS) },
                Feature("ᛒ", "Bluetooth", "Permissions") { render(Screen.BLUETOOTH) }),
            listOf(Feature("◉", "Camera", "Permissions") { render(Screen.CAMERA) },
                Feature("⌁", "Show Cached", "Location") { showCachedLocation() })
        )
        gridRows.forEach { row ->
            val line = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            row.forEachIndexed { index, item ->
                val card = featureCard(item.icon, item.title, item.subtitle, item.action)
                val lp = LinearLayout.LayoutParams(0, dp(88), 1f)
                if (index == 0) lp.marginEnd = dp(8) else lp.marginStart = dp(8)
                lp.bottomMargin = dp(12)
                line.addView(card, lp)
            }
            content.addView(line, LinearLayout.LayoutParams(-1, -2))
        }
        addStatusCard()
    }

    private fun brandHeader() {
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        val logo = TextView(this).apply {
            text = "J"
            gravity = Gravity.CENTER
            textSize = 28f
            typeface = Typeface.create("sans-serif-black", Typeface.BOLD)
            setTextColor(white)
            background = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(cyan, blue, purple)).apply {
                shape = GradientDrawable.OVAL
                setStroke(dp(1), cyan)
            }
        }
        row.addView(logo, LinearLayout.LayoutParams(dp(54), dp(54)))
        val titles = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(12), 0, 0, 0) }
        addText(titles, "JAZZ RECOVERY", 20f, white, true, bottom = 2)
        addText(titles, "Device Recovery & Security", 12f, muted)
        row.addView(titles, LinearLayout.LayoutParams(0, -2, 1f))
        content.addView(row, marginParams(bottom = 18))
    }

    private fun featureCard(icon: String, title: String, subtitle: String, action: () -> Unit): View {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), dp(10), dp(10), dp(10))
            background = shape(panel, 17, if (title == "Location" || title == "Camera") purple else blue, 1)
            isClickable = true
            isFocusable = true
            setOnClickListener { action() }
        }
        val iconView = TextView(this).apply {
            text = icon
            textSize = 25f
            gravity = Gravity.CENTER
            setTextColor(cyan)
            background = GradientDrawable(
                GradientDrawable.Orientation.TL_BR,
                intArrayOf(Color.rgb(17, 40, 76), Color.rgb(9, 25, 54))
            ).apply {
                cornerRadius = dp(14).toFloat()
                setStroke(dp(1), Color.rgb(24, 103, 157))
            }
        }
        card.addView(iconView, LinearLayout.LayoutParams(dp(56), dp(56)))
        val labels = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), 0, dp(3), 0)
        }
        addText(labels, title, 14f, white, true, bottom = 3)
        addText(labels, subtitle, 11f, muted, false)
        card.addView(labels, LinearLayout.LayoutParams(0, -2, 1f))
        val arrow = TextView(this).apply {
            text = "›"
            textSize = 25f
            gravity = Gravity.CENTER
            setTextColor(white)
            background = shape(Color.rgb(17, 48, 88), 24, Color.rgb(23, 71, 120), 1)
        }
        card.addView(arrow, LinearLayout.LayoutParams(dp(36), dp(36)))
        return card
    }

    private fun findPhone() {
        screenHeader("⌖", "Find Phone", "Locate • Lock • Secure")
        val illustration = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER
            setPadding(dp(16), dp(22), dp(16), dp(22))
            background = shape(panelAlt, 24, cyan, 1, glow = true)
        }
        val rings = TextView(this).apply {
            text = "⌖\n▯"
            gravity = Gravity.CENTER
            textSize = 46f
            setLineSpacing(dp(2).toFloat(), 1f)
            setTextColor(cyan)
            background = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(Color.rgb(16, 35, 72), Color.rgb(36, 24, 72))).apply {
                shape = GradientDrawable.OVAL
                setStroke(dp(2), purple)
            }
        }
        illustration.addView(rings, LinearLayout.LayoutParams(dp(170), dp(170)))
        addText(illustration, "DEVICE RECOVERY", 12f, cyan, true, Gravity.CENTER, top = 14)
        content.addView(illustration, marginParams(bottom = 16))
        val card = panelCard()
        addText(card, "◎   Website Access", 18f, white, true, bottom = 8)
        addText(card, "Open our recovery website to locate and manage your device.", 13f, muted, false, bottom = 12)
        val website = configuredWebsiteUrl()
        addText(card, if (website.isBlank()) "Recovery website URL is not configured in this app." else website, 12f, cyan, false, bottom = 12)
        if (website.isBlank()) actionButton(card, "Configure Website URL", "Set") { configureWebsiteUrl() }
        actionButton(card, "Copy Website URL", "Copy") {
            if (validHttpsUrl(website)) { copyText(website); toast("Website URL copied") }
            else toast("No valid recovery website URL is configured")
        }
        actionButton(card, "Open in Browser", "↗") {
            if (!validHttpsUrl(website)) toast("Recovery website URL is missing or invalid. Configure website_url first.")
            else try {
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(website)))
            } catch (_: Exception) { toast("No browser app is available to open this URL") }
        }
        addText(card, "The website opens in your external browser. Phone location and remote actions depend on the paired device, permissions, connectivity, and backend support.", 11f, muted, false, top = 12)
        content.addView(card, marginParams(bottom = 16))
        addStatusCard()
    }

    private fun support() {
        screenHeader("☏", "Support", "Get Help • Contact Us")
        val card = panelCard()
        addText(card, "Contact Information", 19f, white, true, bottom = 5)
        addText(card, "Reach out for any support or queries", 13f, muted, false, bottom = 16)
        contactRow(card, "GMAIL", "Email ID", "gunakarna33@gmail.com", blue) {
            try { startActivity(Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:gunakarna33@gmail.com"))) }
            catch (_: Exception) { toast("No email app is configured") }
        }
        actionButton(card, "Copy email address", "Copy") { copyText("gunakarna33@gmail.com"); toast("Email copied") }
        addDivider(card)
        contactRow(card, "INSTAGRAM", "Instagram", "@gunakarna", purple) {
            openExternal("https://www.instagram.com/gunakarna/", "Could not open Instagram")
        }
        actionButton(card, "Copy Instagram handle", "Copy") { copyText("@gunakarna"); toast("Instagram handle copied") }
        content.addView(card, marginParams(bottom = 16))

        val developer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(20), dp(24), dp(20), dp(24))
            background = shape(panelAlt, 22, purple, 1, glow = true)
        }
        addText(developer, "Developed by", 18f, muted, false, Gravity.CENTER, bottom = 8)
        val name = TextView(this).apply {
            text = "GUNAKARNA"; textSize = 27f; typeface = Typeface.create("sans-serif", Typeface.BOLD_ITALIC)
            setTextColor(cyan); gravity = Gravity.CENTER
        }
        developer.addView(name)
        val underline = View(this).apply { background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(cyan, blue, purple)).apply { cornerRadius = dp(4).toFloat() } }
        developer.addView(underline, LinearLayout.LayoutParams(dp(126), dp(3)).apply { topMargin = dp(9); bottomMargin = dp(15) })
        addText(developer, "Thank you for using Jazz Recovery.\nYour trust keeps us going.", 13f, muted, false, Gravity.CENTER)
        addText(developer, "♡  Developed by Gunakarna", 12f, cyan, true, Gravity.CENTER, top = 22)
        content.addView(developer, marginParams(bottom = 16))
        addStatusCard()
    }

    private fun urlTokens() {
        screenHeader("⌘", "URL Tokens", "View & Manage")
        val card = panelCard()
        addText(card, "Device identity", 18f, white, true, bottom = 6)
        addText(card, "This ID identifies this app installation to the recovery server. Keep the token private and do not regenerate it after pairing.", 12f, muted, false, bottom = 12)
        addText(card, "Device ID", 12f, muted, true, bottom = 3)
        val id = textField("Device ID", deviceId).apply { isFocusable = false; isClickable = false }
        card.addView(id, marginParams(bottom = 8))
        actionButton(card, "Copy Device ID", "Copy") { copyText(deviceId); toast("Device ID copied") }
        addText(card, "Server URL", 12f, muted, true, top = 12, bottom = 3)
        server = textField("https://your-configured-server", prefs.getString("server", "") ?: "")
        card.addView(server, marginParams(bottom = 8))
        actionButton(card, "Save HTTPS URL", "Save") {
            val value = server.text.toString().trim().trimEnd('/')
            if (!validHttpsUrl(value)) toast("Enter a valid HTTPS server URL")
            else { prefs.edit().putString("server", value).apply(); toast("Server URL saved") }
        }
        addText(card, "One-time device token", 12f, muted, true, top = 12, bottom = 3)
        tokenDisplay = textField("Generate or show your device token", "").apply { inputType = 129; isFocusable = false }
        card.addView(tokenDisplay, marginParams(bottom = 8))
        actionButton(card, "Generate / Show Device Token", "Generate") { generateOrShowToken() }
        actionButton(card, "Copy Device Token", "Copy") {
            val token = tokenDisplay.text.toString()
            if (token.isBlank()) toast("Generate / show the token first") else { copyText(token); toast("Device token copied. Keep it private.") }
        }
        actionButton(card, "Test Server /health", "Test") { request("GET", "/health", null, false) }
        actionButton(card, "Send device heartbeat", "Send") {
            val bm = getSystemService(BATTERY_SERVICE) as BatteryManager
            val data = JSONObject().put("deviceId", deviceId).put("deviceName", Build.MODEL).put("mode", "NORMAL_MODE")
                .put("status", JSONObject().put("online", true).put("battery", bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY))
                    .put("charging", bm.isCharging).put("network", "UNKNOWN"))
            request("POST", "/android/device/heartbeat", data, true)
        }

        addDivider(card)
        addText(card, "Re-pair an existing account", 17f, white, true, top = 12, bottom = 4)
        addText(card, "After reinstalling, Android may create a new local ID and token. Enter the same website username and password plus the existing device ID from your website device list. This rotates the token for that existing record without creating a duplicate device.", 12f, muted, false, bottom = 10)
        val repairUsername = textField("Existing account username", "")
        card.addView(repairUsername, marginParams(bottom = 7))
        val repairPassword = textField("Existing account password", "").apply { inputType = 129 }
        card.addView(repairPassword, marginParams(bottom = 7))
        val existingDeviceId = textField("Existing device ID from website", "")
        card.addView(existingDeviceId, marginParams(bottom = 7))
        actionButton(card, "Repair Existing Device", "Secure") {
            repairExistingDevice(server.text.toString(), repairUsername.text.toString(), repairPassword.text.toString(), existingDeviceId.text.toString())
        }
        content.addView(card, marginParams(bottom = 16))
        addStatusCard()
    }

    private fun permissions() {
        screenHeader("◈", "Permissions", "Grant & Control")
        val card = panelCard()
        addText(card, "Permission status", 18f, white, true, bottom = 8)
        permissionLine(card, "Camera", Manifest.permission.CAMERA)
        permissionLine(card, "Fine location", Manifest.permission.ACCESS_FINE_LOCATION)
        permissionLine(card, "Coarse location", Manifest.permission.ACCESS_COARSE_LOCATION)
        permissionLine(card, "Phone state (cellular information)", Manifest.permission.READ_PHONE_STATE)
        actionButton(card, "Enable cellular positioning permission", "Grant") {
            if (checkSelfPermission(Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) requestPermissions(arrayOf(Manifest.permission.READ_PHONE_STATE), 105)
            else toast("Cellular positioning permission is already granted")
        }
        if (Build.VERSION.SDK_INT >= 29) permissionLine(card, "Background location (Allow all the time)", Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        permissionLine(card, "Secure settings (ADB/device-owner grant)", Manifest.permission.WRITE_SECURE_SETTINGS)
        addText(card, "Background access is optional and must be explicitly allowed in Android settings. Declaring WRITE_SECURE_SETTINGS does not grant it; Android/device policy can still refuse global Location changes.", 11f, muted, false, top = 2, bottom = 8)
        if (Build.VERSION.SDK_INT >= 31) permissionLine(card, "Bluetooth connect", Manifest.permission.BLUETOOTH_CONNECT)
        if (Build.VERSION.SDK_INT >= 31) permissionLine(card, "Bluetooth scan", Manifest.permission.BLUETOOTH_SCAN)
        if (Build.VERSION.SDK_INT >= 33) permissionLine(card, "Notifications", Manifest.permission.POST_NOTIFICATIONS)
        actionButton(card, "Request required permissions", "Grant") { requestNeededPermissions() }
        if (Build.VERSION.SDK_INT >= 29) actionButton(card, "Allow all-time background location", "Open") { requestBackgroundLocationPermission() }
        actionButton(card, "Grant WRITE_SECURE_SETTINGS via ADB", "Info") {
            android.app.AlertDialog.Builder(this)
                .setTitle("Advanced Location control")
                .setMessage("Declaring WRITE_SECURE_SETTINGS does not grant it. On supported test devices, connect ADB and run: adb shell pm grant $packageName android.permission.WRITE_SECURE_SETTINGS. Some Android versions/OEMs still block changing the global Location switch. Device-owner provisioning is the supported managed-device route on Android 11+.")
                .setPositiveButton("OK", null).show()
        }
        actionButton(card, "Open app settings", "Open") { startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))) }
        actionButton(card, "Accessibility settings (optional)", "Open") {
            toast("Accessibility is optional and no Jazz accessibility service is currently registered.")
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }
        addText(card, "Accessibility access can expose on-screen content and permit UI actions. Jazz Recovery's current location, camera, token and heartbeat features do not require an accessibility service, so this app does not request broad accessibility access.", 11f, muted, false, top = 12)
        content.addView(card, marginParams(bottom = 16))
        addStatusCard()
    }

    private fun codes() {
        screenHeader("▦", "Generate Codes", "Security Codes")
        val card = panelCard()
        addText(card, "Device token", 18f, white, true, bottom = 8)
        addText(card, "The current app provides a unique device authentication token, not a separate one-time security-code generator. Generate or view the existing device token below; it is stored encrypted with Android Keystore.", 13f, muted, false, bottom = 12)
        tokenDisplay = textField("Device token stays hidden until requested", "").apply { inputType = 129; isFocusable = false }
        card.addView(tokenDisplay, marginParams(bottom = 8))
        actionButton(card, "Generate / Show Device Token", "Generate") { generateOrShowToken() }
        actionButton(card, "Copy Device Token", "Copy") {
            val token = tokenDisplay.text.toString()
            if (token.isBlank()) toast("Generate / show the token first") else { copyText(token); toast("Device token copied. Keep it private.") }
        }
        content.addView(card, marginParams(bottom = 16))
        addStatusCard()
    }

    private fun location() {
        screenHeader("⌖", "Location", "View Location")
        val card = panelCard()
        addText(card, "Location tools", 18f, white, true, bottom = 8)
        addText(card, "Cached location is the most recent location Android has available to this app. It may be old or unavailable if location was disabled, permission was denied, or the device has no cached fix.", 12f, muted, false, bottom = 12)
        addText(card, "Global Location switch: " + if (GlobalLocationController.isEnabled(this)) "ON" else "OFF", 13f, cyan, true, bottom = 8)
        actionButton(card, "Turn Global Location ON", "ON") { changeGlobalLocation(true) }
        actionButton(card, "Turn Global Location OFF", "OFF") { changeGlobalLocation(false) }
        actionButton(card, "Show Cached Location", "⌖") { showCachedLocation() }
        actionButton(card, "Open Location Settings", "Open") { startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)) }
        actionButton(card, "Grant Location Permission", "Grant") { requestLocationPermission() }
        if (Build.VERSION.SDK_INT >= 29) actionButton(card, "Allow all-time background location", "Open") { requestBackgroundLocationPermission() }
        content.addView(card, marginParams(bottom = 16))
        addStatusCard()
    }

    private fun readiness() {
        screenHeader("◉", "Recovery Readiness", "Visible background connection")
        val card = panelCard()
        addText(card, "Owner-enabled recovery agent", 18f, white, true, bottom = 8)
        addText(card, "Recovery readiness uses the existing foreground service and an ongoing notification. Android may restrict camera or background activity; remote actions also require a working server connection, a paired device token and granted permissions.", 12f, muted, false, bottom = 12)
        actionButton(card, "Enable Recovery Readiness", "Start") {
            val savedToken = prefs.getString("secret", null)
            val savedServer = prefs.getString("server", "") ?: ""
            if (!validHttpsUrl(savedServer) || savedToken.isNullOrBlank()) toast("Save the HTTPS server URL and generate the device token first")
            else if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(arrayOf(Manifest.permission.CAMERA), 101)
                toast("Grant camera permission, then enable readiness again")
            } else if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 103)
                toast("Allow notifications, then enable readiness again")
            } else {
                val intent = Intent(this, RecoveryAgentService::class.java)
                if (Build.VERSION.SDK_INT >= 26) startForegroundService(intent) else startService(intent)
                toast("Recovery readiness started. Keep its notification enabled.")
            }
        }
        actionButton(card, "Stop Recovery Readiness", "Stop") {
            stopService(Intent(this, RecoveryAgentService::class.java))
            toast("Recovery readiness stopped")
        }
        content.addView(card, marginParams(bottom = 16))
        addStatusCard()
    }

    private fun bluetooth() {
        screenHeader("ᛒ", "Bluetooth", "Permissions")
        val card = panelCard()
        addText(card, "Bluetooth access", 18f, white, true, bottom = 8)
        if (Build.VERSION.SDK_INT >= 31) {
            permissionLine(card, "Bluetooth connect", Manifest.permission.BLUETOOTH_CONNECT)
            permissionLine(card, "Bluetooth scan", Manifest.permission.BLUETOOTH_SCAN)
            permissionLine(card, "Bluetooth advertise", Manifest.permission.BLUETOOTH_ADVERTISE)
            actionButton(card, "Request Bluetooth permissions", "Grant") {
                val needed = arrayOf(Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_ADVERTISE)
                    .filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }.toTypedArray()
                if (needed.isNotEmpty()) requestPermissions(needed, 102)
                else startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS))
            }
        } else {
            addText(card, "This Android version uses Bluetooth settings for access.", 13f, muted, false, bottom = 8)
            actionButton(card, "Open Bluetooth Settings", "Open") { startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS)) }
        }
        addText(card, "Nearby helper participation is opt-in. Keep Recovery Readiness running for background scanning or beacon advertising.", 11f, muted, false, top = 12)
        actionButton(card, if (prefs.getBoolean("location_helper_opt_in", false)) "Disable trusted helper mode" else "Opt in as a trusted helper", if (prefs.getBoolean("location_helper_opt_in", false)) "Disable" else "Enable") {
            updateLocationHelperSetting("/android/device/location-helper/consent", !prefs.getBoolean("location_helper_opt_in", false), "location_helper_opt_in")
        }
        actionButton(card, if (prefs.getBoolean("location_beacon_enabled", false)) "Disable this phone's recovery beacon" else "Enable this phone's recovery beacon", if (prefs.getBoolean("location_beacon_enabled", false)) "Disable" else "Enable") {
            updateLocationHelperSetting("/android/device/location-helper/beacon-setting", !prefs.getBoolean("location_beacon_enabled", false), "location_beacon_enabled")
        }
        val helperIdInput = EditText(this).apply {
            hint = "Trusted helper device ID"
            setTextColor(white)
            setHintTextColor(muted)
            isSingleLine = true
            textSize = 14f
            setPadding(dp(12), dp(8), dp(12), dp(8))
            background = shape(panelAlt, 10, blue, 1)
        }
        card.addView(helperIdInput, LinearLayout.LayoutParams(-1, dp(48)))
        actionButton(card, "Authorize trusted helper device", "Authorize") {
            authorizeHelperDevice(helperIdInput.text.toString().trim(), true)
        }
        actionButton(card, "Revoke trusted helper device", "Revoke") {
            authorizeHelperDevice(helperIdInput.text.toString().trim(), false)
        }
        addText(card, "Both phones must be registered. The helper owner must opt in first; the target owner then authorizes the helper. Reports are proximity estimates, not exact lost-phone coordinates.", 11f, muted, false, top = 10)
        content.addView(card, marginParams(bottom = 16))
        addStatusCard()
    }

    private fun authorizeHelperDevice(helperDeviceId: String, enabled: Boolean) {
        if (helperDeviceId.isBlank()) { toast("Enter the helper device ID"); return }
        val base = (prefs.getString("server", "") ?: "").trimEnd('/')
        val secret = runCatching { decrypt(prefs.getString("secret", "") ?: "") }.getOrNull()
        if (!validHttpsUrl(base) || secret.isNullOrBlank()) {
            toast("Save the HTTPS server URL and device token first")
            return
        }
        Thread {
            var success = false
            var responseMessage = ""
            try {
                val connection = URL(base + "/android/device/location-helper/authorize").openConnection() as HttpURLConnection
                try {
                    connection.requestMethod = "POST"
                    connection.connectTimeout = 8000
                    connection.readTimeout = 12000
                    connection.instanceFollowRedirects = false
                    connection.setRequestProperty("Authorization", "Bearer " + secret)
                    connection.setRequestProperty("X-Jazz-Lost-Device-Id", deviceId)
                    connection.setRequestProperty("Content-Type", "application/json")
                    connection.doOutput = true
                    connection.outputStream.use {
                        it.write(JSONObject().put("helperDeviceId", helperDeviceId).put("enabled", enabled).toString().toByteArray(Charsets.UTF_8))
                    }
                    val code = connection.responseCode
                    responseMessage = (if (code in 200..299) connection.inputStream else connection.errorStream)
                        ?.bufferedReader()?.use { it.readText().take(400) } ?: ""
                    success = code in 200..299
                } finally { connection.disconnect() }
            } catch (failure: Exception) { responseMessage = failure.javaClass.simpleName }
            runOnUiThread { toast(if (success) (if (enabled) "Trusted helper authorized" else "Trusted helper revoked") else "Could not update helper authorization: " + responseMessage.take(180)) }
        }.start()
    }

    private fun updateLocationHelperSetting(path: String, enabled: Boolean, preferenceKey: String) {
        if (enabled && path.endsWith("/consent")) {
            val needed = mutableListOf<String>()
            if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED)
                needed.add(Manifest.permission.ACCESS_FINE_LOCATION)
            if (Build.VERSION.SDK_INT >= 31 && checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED)
                needed.add(Manifest.permission.BLUETOOTH_SCAN)
            if (needed.isNotEmpty()) {
                requestPermissions(needed.toTypedArray(), 106)
                toast("Grant location and Bluetooth scan permissions, then opt in again")
                return
            }
        }
        if (enabled && path.endsWith("/beacon-setting") && Build.VERSION.SDK_INT >= 31 &&
            checkSelfPermission(Manifest.permission.BLUETOOTH_ADVERTISE) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.BLUETOOTH_ADVERTISE), 107)
            toast("Grant Bluetooth advertising permission, then enable the beacon again")
            return
        }
        val base = (prefs.getString("server", "") ?: "").trimEnd('/')
        val secret = runCatching { decrypt(prefs.getString("secret", "") ?: "") }.getOrNull()
        if (!validHttpsUrl(base) || secret.isNullOrBlank()) {
            toast("Save the HTTPS server URL and device token first")
            return
        }
        Thread {
            var success = false
            var responseMessage = ""
            try {
                val connection = URL(base + path).openConnection() as HttpURLConnection
                try {
                    connection.requestMethod = "POST"
                    connection.connectTimeout = 8000
                    connection.readTimeout = 12000
                    connection.instanceFollowRedirects = false
                    connection.setRequestProperty("Authorization", "Bearer " + secret)
                    connection.setRequestProperty("X-Jazz-Lost-Device-Id", deviceId)
                    connection.setRequestProperty("Content-Type", "application/json")
                    connection.doOutput = true
                    connection.outputStream.use {
                        it.write(JSONObject().put("enabled", enabled).toString().toByteArray(Charsets.UTF_8))
                    }
                    val code = connection.responseCode
                    responseMessage = (if (code in 200..299) connection.inputStream else connection.errorStream)
                        ?.bufferedReader()?.use { it.readText().take(400) } ?: ""
                    success = code in 200..299
                } finally { connection.disconnect() }
            } catch (failure: Exception) {
                responseMessage = failure.javaClass.simpleName
            }
            runOnUiThread {
                if (success) {
                    prefs.edit().putBoolean(preferenceKey, enabled).apply()
                    toast(if (enabled) "Location helper setting enabled" else "Location helper setting disabled")
                    render(Screen.BLUETOOTH)
                } else {
                    toast("Could not update helper setting: " + responseMessage.take(180))
                }
            }
        }.start()
    }

    private fun camera() {
        screenHeader("◉", "Camera", "Permissions")
        val card = panelCard()
        addText(card, "Camera permission", 18f, white, true, bottom = 8)
        permissionLine(card, "Camera", Manifest.permission.CAMERA)
        actionButton(card, "Grant Camera Permission", "Grant") {
            if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED)
                requestPermissions(arrayOf(Manifest.permission.CAMERA), 101)
            else toast("Camera permission is already granted")
        }
        addText(card, "Recovery photo capture is attempted only through the existing owner-enabled foreground service. Android or device-maker background-camera restrictions may still prevent capture.", 12f, muted, false, top = 12)
        content.addView(card, marginParams(bottom = 16))
        addStatusCard()
    }

    private fun screenHeader(icon: String, title: String, subtitle: String) {
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        val back = TextView(this).apply {
            text = "‹"; textSize = 34f; setTextColor(cyan); gravity = Gravity.CENTER
            isClickable = true; isFocusable = true; setOnClickListener { render(Screen.HOME) }
        }
        row.addView(back, LinearLayout.LayoutParams(dp(42), dp(48)))
        val iconView = TextView(this).apply {
            text = icon; textSize = 25f; setTextColor(cyan); gravity = Gravity.CENTER
            background = shape(panelAlt, 14, purple, 1)
        }
        row.addView(iconView, LinearLayout.LayoutParams(dp(46), dp(46)))
        val titles = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(11), 0, 0, 0) }
        addText(titles, title, 20f, white, true, bottom = 2)
        addText(titles, subtitle, 12f, muted)
        row.addView(titles, LinearLayout.LayoutParams(0, -2, 1f))
        content.addView(row, marginParams(bottom = 18))
    }

    private fun buildBottomNav() {
        bottomNav.removeAllViews()
        val items = listOf(
            Triple("⌂", "Home", Screen.HOME),
            Triple("⌖", "Find Phone", Screen.FIND_PHONE),
            Triple("☏", "Support", Screen.SUPPORT)
        )
        items.forEach { (icon, label, screen) ->
            val selected = currentScreen == screen
            val item = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                isClickable = true
                isFocusable = true
                setPadding(dp(4), dp(2), dp(4), dp(2))
                setOnClickListener { if (currentScreen != screen) render(screen) }
            }
            addText(item, icon, 21f, if (selected) cyan else muted, true, Gravity.CENTER, bottom = 0)
            addText(item, label, 11f, if (selected) cyan else muted, selected, Gravity.CENTER, top = 0, bottom = 2)
            val underline = View(this).apply {
                background = GradientDrawable().apply { setColor(if (selected) cyan else Color.TRANSPARENT); cornerRadius = dp(3).toFloat() }
            }
            item.addView(underline, LinearLayout.LayoutParams(dp(28), dp(3)))
            bottomNav.addView(item, LinearLayout.LayoutParams(0, -1, 1f))
        }
    }

    private fun panelCard(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(16), dp(16), dp(16), dp(16))
        background = shape(panel, 20, blue, 1, glow = true)
    }

    private fun addStatusCard() {
        status.text = "Ready • Device ID: ${deviceId.take(25)}${if (deviceId.length > 25) "…" else ""}"
        status.textSize = 11f
        status.setTextColor(cyan)
        status.setPadding(dp(12), dp(10), dp(12), dp(10))
        status.background = shape(Color.rgb(8, 28, 48), 12, Color.rgb(23, 86, 121), 1)
        content.addView(status, marginParams(top = 8, bottom = 12))
    }

    private fun permissionLine(parent: LinearLayout, label: String, permission: String) {
        val granted = checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(0, dp(7), 0, dp(7)) }
        val labelView = TextView(this).apply {
            text = label
            textSize = 13f
            setTextColor(white)
        }
        row.addView(labelView, LinearLayout.LayoutParams(0, -2, 1f))
        val state = TextView(this).apply {
            text = if (granted) "GRANTED" else "NOT GRANTED"
            textSize = 10f; typeface = Typeface.DEFAULT_BOLD
            setTextColor(if (granted) cyan else Color.rgb(255, 174, 130))
            gravity = Gravity.END
        }
        row.addView(state, LinearLayout.LayoutParams(0, -2, 1f))
        parent.addView(row)
    }

    private fun requestNeededPermissions() {
        val needed = mutableListOf<String>()
        listOf(Manifest.permission.CAMERA, Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION).forEach {
            if (checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED) needed.add(it)
        }
        if (Build.VERSION.SDK_INT >= 31) {
            listOf(Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_SCAN).forEach {
                if (checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED) needed.add(it)
            }
        }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            needed.add(Manifest.permission.POST_NOTIFICATIONS)
        if (needed.isNotEmpty()) requestPermissions(needed.toTypedArray(), 104) else toast("All requested permissions are already granted")
    }

    private fun requestLocationPermission() {
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED ||
            checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION), 100)
        } else toast("Foreground location permission is already granted")
    }

    private fun requestBackgroundLocationPermission() {
        if (Build.VERSION.SDK_INT < 29) {
            toast("Background location permission is not required separately on this Android version")
            return
        }
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED &&
            checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            toast("Grant foreground location permission first")
            requestLocationPermission()
            return
        }
        if (Build.VERSION.SDK_INT == 29) {
            if (checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(arrayOf(Manifest.permission.ACCESS_BACKGROUND_LOCATION), 105)
            } else toast("Background location permission is already granted")
        } else {
            android.app.AlertDialog.Builder(this)
                .setTitle("Allow all the time")
                .setMessage("On Android 11 and later, choose Jazz Recovery in App settings → Permissions → Location → Allow all the time. Android requires this separate user action.")
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Open settings") { _, _ ->
                    startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
                }.show()
        }
    }

    private fun changeGlobalLocation(enabled: Boolean) {
        val result = GlobalLocationController.setEnabled(this, enabled)
        val confirmed = result.optBoolean("ok", false)
        val actual = result.optString("locationServices", "UNKNOWN")
        status.text = "Global Location: " + actual
        if (confirmed) {
            toast("Global Location is confirmed " + (if (enabled) "ON" else "OFF"))
        } else {
            val error = result.optString("error", "NOT_CONFIRMED")
            toast("Android did not confirm Location " + (if (enabled) "ON" else "OFF") + " (" + error + "). Open Location Settings to change it manually.")
            startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))
        }
    }

    private fun showCachedLocation() {
        if (checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED &&
            checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            toast("Location permission required")
            requestLocationPermission()
            return
        }
        try {
            val lm = getSystemService(LOCATION_SERVICE) as LocationManager
            val loc = lm.getProviders(true).mapNotNull { runCatching { lm.getLastKnownLocation(it) }.getOrNull() }.maxByOrNull { it.time }
            toast(if (loc == null) "No cached location available" else "${loc.latitude}, ${loc.longitude} • accuracy ${loc.accuracy} m")
            if (loc != null) status.text = "Cached location: ${loc.latitude}, ${loc.longitude} • ${loc.accuracy} m"
        } catch (_: SecurityException) { toast("Location permission is required") }
    }

    private fun getOrCreateDeviceToken(): String {
        val existing = prefs.getString("secret", null)
        return if (!existing.isNullOrBlank()) decrypt(existing) else {
            val bytes = ByteArray(32)
            java.security.SecureRandom().nextBytes(bytes)
            Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
                .also { prefs.edit().putString("secret", encrypt(it)).apply() }
        }
    }

    private fun generateOrShowToken() {
        try {
            tokenDisplay.setText(getOrCreateDeviceToken())
            toast("Token ready. Register this exact token; do not regenerate after pairing.")
        } catch (_: Exception) { toast("Token generation or secure storage failed") }
    }

    private fun repairExistingDevice(serverInput: String, usernameInput: String, passwordInput: String, existingIdInput: String) {
        val base = serverInput.trim().trimEnd('/')
        val username = usernameInput.trim()
        val password = passwordInput
        val existingId = existingIdInput.trim()
        if (!validHttpsUrl(base)) { toast("Enter the valid HTTPS server URL first"); return }
        if (username.isBlank() || password.isBlank()) { toast("Enter your existing website username and password"); return }
        if (existingId.length !in 8..128 || !existingId.matches(Regex("[A-Za-z0-9._:-]+"))) {
            toast("Enter the existing device ID shown in your website device list"); return
        }

        // Save a retryable token before contacting the server. If the server rotates the
        // token but the response is lost, the next attempt reuses the same token.
        val pendingId = prefs.getString("pending_repair_device_id", "") ?: ""
        val pendingEncrypted = prefs.getString("pending_repair_token", "") ?: ""
        val reusedToken = if (pendingId.equals(existingId, ignoreCase = true) && pendingEncrypted.isNotBlank()) {
            runCatching { decrypt(pendingEncrypted) }.getOrNull()?.takeIf { it.isNotBlank() }
        } else null
        val newToken = reusedToken ?: Base64.encodeToString(
            ByteArray(32).also { java.security.SecureRandom().nextBytes(it) },
            Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING
        )
        val encryptedToken = try { encrypt(newToken) } catch (_: Exception) {
            toast("Secure token storage failed; no repair request was sent")
            return
        }
        if (!prefs.edit()
                .putString("pending_repair_device_id", existingId)
                .putString("pending_repair_token", encryptedToken)
                .commit()) {
            toast("Could not safely save the pending token; no repair request was sent")
            return
        }

        status.text = "Verifying account and restoring the existing device…"
        Thread {
            var code = 0
            var responseText = ""
            var connectionError = ""
            try {
                val connection = URL(base + "/api/auth/device-repair").openConnection() as HttpURLConnection
                try {
                    connection.requestMethod = "POST"
                    connection.connectTimeout = 10000
                    connection.readTimeout = 20000
                    connection.instanceFollowRedirects = false
                    connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                    connection.setRequestProperty("Accept", "application/json")
                    connection.doOutput = true
                    val body = JSONObject()
                        .put("username", username)
                        .put("password", password)
                        .put("deviceId", existingId)
                        .put("deviceToken", newToken)
                        .put("deviceName", Build.MODEL.take(80))
                    connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
                    code = connection.responseCode
                    responseText = (if (code in 200..299) connection.inputStream else connection.errorStream)
                        ?.bufferedReader()?.use { it.readText().take(2000) }.orEmpty()
                } finally { connection.disconnect() }
            } catch (failure: Exception) {
                connectionError = "Connection failed: " + failure.javaClass.simpleName
            }

            val response = runCatching { JSONObject(responseText) }.getOrNull()
            val repaired = code in 200..299 && response?.optBoolean("ok", false) == true
            val canonicalId = response?.optString("deviceId", existingId)?.trim()?.ifBlank { existingId } ?: existingId
            val serverError = response?.optString("error")?.takeIf { it.isNotBlank() }
                ?: response?.optString("message")?.takeIf { it.isNotBlank() }
            runOnUiThread {
                if (repaired) {
                    val saved = prefs.edit()
                        .putString("server", base)
                        .putString("device_id", canonicalId)
                        .putString("secret", encryptedToken)
                        .remove("pending_repair_device_id")
                        .remove("pending_repair_token")
                        .commit()
                    if (saved) {
                        deviceId = canonicalId
                        render(Screen.URL_TOKENS)
                        if (::status.isInitialized) status.text = "Existing device restored. Device ID and recovery history preserved."
                        toast("Existing device restored. Keep the new device token private.")
                    } else {
                        status.text = "Server restored the device, but local token save failed. Retry using the same account and Device ID."
                        toast("Device token could not be saved securely. Retry the repair.")
                    }
                } else {
                    val detail = serverError ?: "Check the existing account credentials, Device ID, and server URL."
                    val message = when {
                        code == 0 -> connectionError.ifBlank { "Could not connect to the recovery server." }
                        code == 401 -> "Repair failed: the server rejected the username or password."
                        code == 404 -> "Device not found under this account. Use the original Device ID from the website."
                        code == 409 -> detail
                        code == 429 -> "Too many attempts. Wait before trying again."
                        code in 200..299 -> "Server returned HTTP " + code + " but did not confirm device repair: " + detail
                        else -> "Device repair failed (HTTP " + code + "): " + detail
                    }
                    status.text = message
                    toast(message)
                }
            }
        }.start()
    }

    private fun configureWebsiteUrl() {
        val input = EditText(this).apply {
            hint = "https://your-recovery-website"
            setText(prefs.getString("website_url", "") ?: "")
            setSingleLine(true)
        }
        android.app.AlertDialog.Builder(this)
            .setTitle("Recovery website URL")
            .setMessage("Enter the real HTTPS URL of your Jazz Recovery website. This is separate from the backend server URL.")
            .setView(input)
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Save") { _, _ ->
                val value = input.text.toString().trim().trimEnd('/')
                if (!validHttpsUrl(value)) toast("Enter a valid HTTPS website URL")
                else {
                    prefs.edit().putString("website_url", value).apply()
                    toast("Recovery website URL saved")
                    render(Screen.FIND_PHONE)
                }
            }
            .show()
    }

    private fun configuredWebsiteUrl(): String {
        val saved = prefs.getString("website_url", null)?.trim().orEmpty()
        return saved.trimEnd('/')
    }

    private fun validHttpsUrl(value: String): Boolean {
        return try {
            val parsed = URL(value)
            parsed.protocol == "https" && !parsed.host.isNullOrBlank() && parsed.userInfo == null && parsed.query == null && parsed.ref == null
        } catch (_: Exception) { false }
    }

    private fun openExternal(url: String, error: String) {
        try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
        catch (_: Exception) { toast(error) }
    }

    private fun contactRow(parent: LinearLayout, icon: String, label: String, value: String, accent: Int, action: () -> Unit) {
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(0, dp(8), 0, dp(8)); isClickable = true; setOnClickListener { action() } }
        val isGmail = icon == "GMAIL"
        val isInstagram = icon == "INSTAGRAM"
        val iconView = TextView(this).apply {
            text = when { isGmail -> "M"; isInstagram -> "◎"; else -> icon }
            textSize = if (isGmail) 25f else 23f
            typeface = Typeface.create("sans-serif", Typeface.BOLD)
            gravity = Gravity.CENTER
            setTextColor(if (isGmail) Color.rgb(234, 67, 53) else white)
            background = when {
                isGmail -> GradientDrawable().apply {
                    setColor(Color.WHITE)
                    cornerRadius = dp(13).toFloat()
                    setStroke(dp(1), Color.rgb(218, 220, 224))
                }
                isInstagram -> GradientDrawable(GradientDrawable.Orientation.TL_BR,
                    intArrayOf(Color.rgb(245, 133, 41), Color.rgb(221, 42, 123), Color.rgb(129, 52, 175), Color.rgb(81, 91, 212))).apply {
                    cornerRadius = dp(13).toFloat()
                }
                else -> GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(accent, purple)).apply { cornerRadius = dp(13).toFloat() }
            }
        }
        row.addView(iconView, LinearLayout.LayoutParams(dp(46), dp(46)))
        val labels = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(12), 0, dp(4), 0) }
        addText(labels, label, 11f, muted, false, bottom = 3)
        addText(labels, value, 13f, white, true)
        row.addView(labels, LinearLayout.LayoutParams(0, -2, 1f))
        val copy = TextView(this).apply {
            text = "▢"; textSize = 21f; gravity = Gravity.CENTER; setTextColor(cyan)
            isClickable = true; setOnClickListener { copyText(value); toast("$label copied") }
        }
        row.addView(copy, LinearLayout.LayoutParams(dp(40), dp(46)))
        parent.addView(row, LinearLayout.LayoutParams(-1, -2))
    }

    private fun actionButton(parent: LinearLayout, title: String, trailing: String, action: () -> Unit) {
        val button = TextView(this).apply {
            text = "$title     $trailing"
            textSize = 13f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(white)
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(14), dp(13), dp(14), dp(13))
            background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(Color.rgb(14, 130, 210), Color.rgb(104, 67, 218))).apply {
                cornerRadius = dp(13).toFloat()
                setStroke(dp(1), Color.argb(180, Color.red(cyan), Color.green(cyan), Color.blue(cyan)))
            }
            isClickable = true; isFocusable = true
            setOnClickListener { action() }
        }
        parent.addView(button, marginParams(top = 7, bottom = 3))
    }

    private fun addDivider(parent: LinearLayout) {
        parent.addView(View(this).apply { setBackgroundColor(Color.rgb(34, 54, 89)) }, LinearLayout.LayoutParams(-1, dp(1)).apply { topMargin = dp(10); bottomMargin = dp(10) })
    }

    private fun textField(hint: String, value: String): EditText = EditText(this).apply {
        this.hint = hint
        setText(value)
        setTextColor(white)
        setHintTextColor(muted)
        textSize = 13f
        setSingleLine(true)
        setPadding(dp(12), dp(10), dp(12), dp(10))
        background = shape(Color.rgb(7, 15, 33), 12, Color.rgb(38, 79, 128), 1)
    }

    private fun addText(
        parent: LinearLayout, value: String, size: Float, color: Int, bold: Boolean = false,
        gravity: Int = Gravity.START, top: Int = 0, bottom: Int = 0
    ) {
        val view = TextView(this).apply {
            text = value
            textSize = size
            setTextColor(color)
            if (bold) typeface = Typeface.create("sans-serif", Typeface.BOLD)
            this.gravity = gravity
            setPadding(0, dp(top), 0, dp(bottom))
            setLineSpacing(dp(2).toFloat(), 1f)
        }
        parent.addView(view, LinearLayout.LayoutParams(-1, -2))
    }

    private fun shape(color: Int, radius: Int, strokeColor: Int, strokeWidth: Int, glow: Boolean = false, topOnly: Boolean = false): GradientDrawable {
        val drawable = GradientDrawable().apply {
            setColor(color)
            cornerRadius = dp(radius).toFloat()
            if (strokeWidth > 0) setStroke(dp(strokeWidth), strokeColor)
        }
        return drawable
    }

    private fun marginParams(top: Int = 0, bottom: Int = 0): LinearLayout.LayoutParams =
        LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(top); bottomMargin = dp(bottom) }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun copyText(value: String) {
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("Jazz Recovery", value))
    }

    private fun toast(value: String) = Toast.makeText(this, value, Toast.LENGTH_LONG).show()

    private fun request(method: String, path: String, data: JSONObject?, auth: Boolean) {
        val base = prefs.getString("server", "") ?: ""
        if (!validHttpsUrl(base)) { toast("Configure a valid HTTPS server first"); return }
        val secret = if (auth) runCatching { decrypt(prefs.getString("secret", "") ?: "") }.getOrNull() else null
        if (auth && secret.isNullOrBlank()) { toast("Generate and securely save the device token first"); return }
        status.text = "Connecting…"
        Thread {
            val message = try {
                val conn = URL(base.trimEnd('/') + path).openConnection() as HttpURLConnection
                try {
                    conn.requestMethod = method
                    conn.connectTimeout = 8000
                    conn.readTimeout = 12000
                    conn.instanceFollowRedirects = false
                    if (auth) {
                        conn.setRequestProperty("Authorization", "Bearer " + secret)
                        conn.setRequestProperty("X-Jazz-Lost-Device-Id", deviceId)
                    }
                    if (data != null) {
                        conn.doOutput = true
                        conn.setRequestProperty("Content-Type", "application/json")
                        conn.outputStream.use { it.write(data.toString().toByteArray(Charsets.UTF_8)) }
                    }
                    val code = conn.responseCode
                    val responseText = (if (code in 200..299) conn.inputStream else conn.errorStream)
                        ?.bufferedReader()?.use { it.readText().take(1200) } ?: ""
                    val response = runCatching { JSONObject(responseText) }.getOrNull()
                    if (code in 200..299 && (response == null || !response.has("ok") || response.optBoolean("ok", false))) {
                        when {
                            path == "/health" -> "Server connection successful."
                            path == "/android/device/heartbeat" -> "Device connected. Server accepted the heartbeat."
                            else -> response?.optString("message")?.takeIf { it.isNotBlank() }
                                ?: "Request completed successfully."
                        }
                    } else {
                        val detail = response?.optString("error")?.takeIf { it.isNotBlank() }
                            ?: response?.optString("message")?.takeIf { it.isNotBlank() }
                            ?: "The server rejected the request."
                        when (code) {
                            401 -> "Device authentication failed. Restore the existing device with your account credentials."
                            404 -> "Device or API endpoint not found. Check the registered Device ID and server URL."
                            429 -> "Too many requests. Wait and try again."
                            else -> "Request failed (HTTP " + code + "): " + detail
                        }
                    }
                } finally { conn.disconnect() }
            } catch (e: Exception) { "Connection failed: " + e.javaClass.simpleName }
            runOnUiThread { if (::status.isInitialized) status.text = message }
        }.start()
    }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey("jazz_recovery_key_v1", null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder("jazz_recovery_key_v1", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }

    private fun encrypt(value: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        return Base64.encodeToString(cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
    }

    private fun decrypt(value: String): String {
        val bytes = Base64.decode(value, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12))) }
        return String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8)
    }

    /** Decorative shield emblem for the Home hero; no recovery logic is attached to it. */
    private inner class ShieldEmblemView : View(this@MainActivity) {
        private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG)
        private val edgePaint = Paint(Paint.ANTI_ALIAS_FLAG)
        private val markPaint = Paint(Paint.ANTI_ALIAS_FLAG)

        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            val w = width.toFloat()
            val h = height.toFloat()
            val shield = Path().apply {
                moveTo(w * 0.50f, h * 0.07f)
                cubicTo(w * 0.66f, h * 0.15f, w * 0.80f, h * 0.17f, w * 0.87f, h * 0.20f)
                lineTo(w * 0.84f, h * 0.54f)
                cubicTo(w * 0.81f, h * 0.73f, w * 0.65f, h * 0.87f, w * 0.50f, h * 0.94f)
                cubicTo(w * 0.35f, h * 0.87f, w * 0.19f, h * 0.73f, w * 0.16f, h * 0.54f)
                lineTo(w * 0.13f, h * 0.20f)
                cubicTo(w * 0.20f, h * 0.17f, w * 0.34f, h * 0.15f, w * 0.50f, h * 0.07f)
                close()
            }
            fillPaint.style = Paint.Style.FILL
            fillPaint.shader = LinearGradient(0f, 0f, w, h, intArrayOf(Color.rgb(22, 185, 255), blue, purple), null, Shader.TileMode.CLAMP)
            canvas.drawPath(shield, fillPaint)
            fillPaint.shader = null

            edgePaint.style = Paint.Style.STROKE
            edgePaint.strokeWidth = dp(2).toFloat()
            edgePaint.color = Color.rgb(180, 238, 255)
            canvas.drawPath(shield, edgePaint)

            val check = Path().apply {
                moveTo(w * 0.34f, h * 0.49f)
                lineTo(w * 0.45f, h * 0.60f)
                lineTo(w * 0.67f, h * 0.38f)
            }
            markPaint.style = Paint.Style.STROKE
            markPaint.strokeWidth = dp(5).toFloat()
            markPaint.strokeCap = Paint.Cap.ROUND
            markPaint.strokeJoin = Paint.Join.ROUND
            markPaint.color = Color.WHITE
            canvas.drawPath(check, markPaint)
        }
    }

}
