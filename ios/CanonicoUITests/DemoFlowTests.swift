import XCTest

final class DemoFlowTests: XCTestCase {
    func testRetireChangesAnswer() throws {
        let app = XCUIApplication()
        app.launch()

        let demo = app.buttons["Enter as Giulia (demo)"]
        if demo.waitForExistence(timeout: 10) {
            snap(app, "0-login")
            demo.tap()
        }

        let send = app.buttons["send"]
        XCTAssertTrue(send.waitForExistence(timeout: 15))
        send.tap()
        XCTAssertTrue(app.staticTexts["Three to four weeks."].waitForExistence(timeout: 60))
        snap(app, "1-ask")

        app.buttons["openTopic"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["3–4 weeks"].waitForExistence(timeout: 15))
        snap(app, "2-believes")

        app.buttons["retireStale"].tap()
        let confirm = app.buttons["Confirm retire"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 10))
        snap(app, "3-retire")
        confirm.tap()
        XCTAssertTrue(app.buttons["retireStale"].waitForNonExistence(timeout: 15))
        snap(app, "4-after-retire")

        let askAgain = app.buttons["askAgain"]
        XCTAssertTrue(askAgain.waitForExistence(timeout: 10))
        askAgain.tap()
        let changed = app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'Changed because'")).firstMatch
        XCTAssertTrue(changed.waitForExistence(timeout: 60))
        snap(app, "5-changed")
    }

    private func snap(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot())
        a.name = name
        a.lifetime = .keepAlways
        add(a)
    }
}

final class TabsTests: XCTestCase {
    func testTabsLoad() throws {
        let app = XCUIApplication()
        app.launch()
        let demo = app.buttons["Enter as Giulia (demo)"]
        if demo.waitForExistence(timeout: 5) { demo.tap() }
        _ = app.buttons["send"].waitForExistence(timeout: 10)
        let ask = XCTAttachment(screenshot: app.screenshot())
        ask.name = "tab-ask"
        ask.lifetime = .keepAlways
        add(ask)
        for (i, name) in ["Memory", "Review", "Activity", "You"].enumerated() {
            app.tabBars.buttons[name].tap()
            sleep(3)
            let a = XCTAttachment(screenshot: app.screenshot())
            a.name = "tab-\(i)-\(name)"
            a.lifetime = .keepAlways
            add(a)
        }
    }

    func testItalianAsk() throws {
        let app = XCUIApplication()
        app.launchArguments += ["-lang", "it"]
        app.launch()
        let demo = app.buttons["Entra come Giulia (demo)"]
        if demo.waitForExistence(timeout: 5) { demo.tap() }
        XCTAssertTrue(app.buttons["send"].waitForExistence(timeout: 10))
        let a = XCTAttachment(screenshot: app.screenshot())
        a.name = "it-ask"
        a.lifetime = .keepAlways
        add(a)
    }
}
