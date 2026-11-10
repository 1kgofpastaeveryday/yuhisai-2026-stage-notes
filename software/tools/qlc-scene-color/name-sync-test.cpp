#include <QApplication>
#include <QFile>
#include <QSettings>
#include <QQmlContext>
#include <QSignalSpy>
#include <QTemporaryDir>
#include <QtTest>
#include <QTcpServer>
#include <QWebSocket>
#include "app.h"
#include "doc.h"
#include "functionmanager.h"
#include "functioneditor.h"
#include "tardis.h"
#include "virtualconsole.h"
#include "vcbutton.h"
#include "scene.h"
#include "genericfader.h"
#include "fadechannel.h"
#include "fixturegroup.h"
#include "inputoutputmap.h"
#include "mastertimer.h"
#include "webaccess-qml.h"
#define private public
#include "rgbmatrix.h"
#undef private

class NameSyncTest : public QObject
{
    Q_OBJECT
private:
    void verifyFadeWebAPI(App &app)
    {
        QTcpServer reservation;
        QVERIFY(reservation.listen(QHostAddress::<HOST>, 0));
        const quint16 port = reservation.serverPort(); reservation.close();
        const QUrl url(QString("ws://127.0.0.1:%1/qlcplusWS").arg(port));
        {
            WebAccessQml web(app.doc(), app.virtualConsole(), app.simpleDesk(), port, false);
            QWebSocket owner, observer;
            owner.open(url); observer.open(url);
            QTRY_COMPARE(owner.state(), QAbstractSocket::ConnectedState);
            QTRY_COMPARE(observer.state(), QAbstractSocket::ConnectedState);
            owner.sendTextMessage("QLC+API|setBrightnessOverride|1|75");
            QTRY_COMPARE(GenericFader::brightnessOverride(),75);
            owner.sendTextMessage("QLC+API|setBrightnessOverride|1|101");QTest::qWait(20);
            QCOMPARE(GenericFader::brightnessOverride(),75);
            owner.sendTextMessage("QLC+API|setBrightnessOverride|0|100");QTRY_COMPARE(GenericFader::brightnessOverride(),-1);
            owner.sendTextMessage("QLC+API|setBrightnessOverride|1|75");QTRY_COMPARE(GenericFader::brightnessOverride(),75);
            owner.sendTextMessage("QLC+API|setRGBBrightnessOverride|1|35");
            QTRY_COMPARE(GenericFader::rgbBrightnessOverride(),35);
            for (const char *bad : {"QLC+API|setRGBBrightnessOverride|2|50",
                 "QLC+API|setRGBBrightnessOverride|1|101", "QLC+API|setRGBBrightnessOverride|1|NaN",
                 "QLC+API|setRGBBrightnessOverride|1|-1", "QLC+API|setRGBBrightnessOverride|1"})
                owner.sendTextMessage(QString::fromLatin1(bad));
            QTest::qWait(30); QCOMPARE(GenericFader::rgbBrightnessOverride(),35);
            QCOMPARE(GenericFader::brightnessOverride(),75);
            QSignalSpy messages(&owner, &QWebSocket::textMessageReceived);
            owner.sendTextMessage("QLC+API|setFadeOverride|1|1000|250");
            QTRY_COMPARE(Function::globalFadeInOverride(), 1000);
            QCOMPARE(Function::globalFadeOutOverride(), 250);
            QTRY_VERIFY(!messages.isEmpty());
            QVERIFY(messages.last().at(0).toString().contains("setFadeOverride|OK"));
            for (const char *bad : {"QLC+API|setFadeOverride|1|-1|250",
                "QLC+API|setFadeOverride|1|1001|250", "QLC+API|setFadeOverride|2|0|0",
                "QLC+API|setFadeOverride|1|NaN|0", "QLC+API|setFadeOverride|1|0"})
                owner.sendTextMessage(QString::fromLatin1(bad));
            QTest::qWait(50);
            QCOMPARE(Function::globalFadeInOverride(), 1000);
            QCOMPARE(Function::globalFadeOutOverride(), 250);
            observer.close(); QTRY_COMPARE(observer.state(), QAbstractSocket::UnconnectedState);
            QCOMPARE(Function::globalFadeInOverride(), 1000);
            owner.close(); QTRY_COMPARE(Function::globalFadeInOverride(), -1);
            QTRY_COMPARE(GenericFader::rgbBrightnessOverride(), -1);
            QTRY_COMPARE(GenericFader::brightnessOverride(), -1);
            QCOMPARE(Function::globalFadeOutOverride(), -1);
            owner.open(url); QTRY_COMPARE(owner.state(), QAbstractSocket::ConnectedState);
            owner.sendTextMessage("QLC+API|setFadeOverride|1|0|1000");
            QTRY_COMPARE(Function::globalFadeInOverride(), 0);
            QCOMPARE(Function::globalFadeOutOverride(), 1000);
            owner.sendTextMessage("QLC+API|setRGBBrightnessOverride|1|60");
            QTRY_COMPARE(GenericFader::rgbBrightnessOverride(),60);
            QVERIFY(QMetaObject::invokeMethod(&web, "slotDocLoaded", Qt::DirectConnection));
            QCOMPARE(Function::globalFadeInOverride(), -1);
            QCOMPARE(GenericFader::rgbBrightnessOverride(), -1);
            owner.sendTextMessage("QLC+API|setFadeOverride|1|500|500");
            QTRY_COMPARE(Function::globalFadeInOverride(), 500);
            owner.sendTextMessage("QLC+API|setRGBBrightnessOverride|1|90");
            QTRY_COMPARE(GenericFader::rgbBrightnessOverride(),90);
            owner.sendTextMessage("QLC+API|setFadeOverride|0|0|0");
            QTRY_COMPARE(Function::globalFadeInOverride(), -1);
            owner.sendTextMessage("QLC+API|setFadeOverride|1|500|500");
            QTRY_COMPARE(Function::globalFadeInOverride(), 500);
        }
        QCOMPARE(Function::globalFadeInOverride(), -1);
        QCOMPARE(Function::globalFadeOutOverride(), -1);
        QCOMPARE(GenericFader::rgbBrightnessOverride(), -1);
    }
    void verifyFadeOverrides(App &app)
    {
        auto *doc = app.doc();
        auto *timer = doc->masterTimer();
        timer->stop(); // Deterministic manual ticks; the fixture has no I/O.
        auto *universe = doc->inputOutputMap()->universe(0);
        QVERIFY(universe);
        const int address = doc->fixture(5)->address() + 2;
        auto active = [&](quint32 id) {
            for (const auto &fader : universe->faders())
                if (fader->parentFunctionID() == id && !fader->deleteRequested()) return fader;
            return QSharedPointer<GenericFader>();
        };
        auto clean = [&](quint32 id) {
            for (const auto &fader : universe->faders())
                if (fader->parentFunctionID() == id) universe->dismissFader(fader);
            universe->reset();
        };
        auto tick = [&](QSharedPointer<GenericFader> fader, int ms) {
            universe->zeroIntensityChannels(); fader->write(universe, ms);
            return int(universe->preGMValue(address));
        };
        auto saved = [](Function &function) {
            QByteArray xml; QXmlStreamWriter writer(&xml); function.saveXML(&writer); return xml;
        };
        Scene probe(doc); probe.setID(9998); probe.setName("runtime fade proof");
        probe.setValue(SceneValue(5, 2, 255));
        probe.setFadeInSpeed(200); probe.setFadeOutSpeed(300);
        const auto original = saved(probe);
        const QList<Universe *> universes = {universe};
        Function::setGlobalFadeOverride(1000, 250);
        QCOMPARE(Function::globalFadeInOverride(), 1000);
        QCOMPARE(Function::globalFadeOutOverride(), 250);
        Function::setGlobalFadeOverride(1001, 250);
        Function::setGlobalFadeOverride(100, -2);
        QCOMPARE(Function::globalFadeInOverride(), 1000);
        QCOMPARE(Function::globalFadeOutOverride(), 250);
        // Real Flash path, including release during a partially completed fade.
        probe.flash(timer, false, false); probe.writeDMX(timer, universes);
        auto fader = active(probe.id()); QVERIFY(!fader.isNull());
        QCOMPARE(fader->channels().begin()->fadeTime(), uint(1000));
        QCOMPARE(tick(fader, 500), 127);
        probe.unFlash(timer); probe.writeDMX(timer, universes);
        QVERIFY(fader->isFadingOut());
        QCOMPARE(fader->channels().begin()->fadeTime(), uint(250));
        QCOMPARE(tick(fader, 125), 64);
        QCOMPARE(tick(fader, 125), 0);
        QCOMPARE(saved(probe), original);
        clean(probe.id());
        // Both0ms and1000ms are valid endpoints; Off restores the native speed.
        Function::setGlobalFadeOverride(0, 0);
        probe.flash(timer, false, false); probe.writeDMX(timer, universes);
        fader = active(probe.id()); QVERIFY(!fader.isNull());
        QCOMPARE(tick(fader, 20), 255);
        probe.unFlash(timer); probe.writeDMX(timer, universes);
        QVERIFY(fader->deleteRequested()); clean(probe.id());
        Function::setGlobalFadeOverride(-1, -1);
        probe.write(timer, universes); fader = active(probe.id()); QVERIFY(!fader.isNull());
        QCOMPARE(fader->channels().begin()->fadeTime(), uint(200));
        probe.postRun(timer, universes);
        QCOMPARE(fader->channels().begin()->fadeTime(), uint(300)); clean(probe.id());
        // Global values are milliseconds even when the Scene uses beat tempo.
        probe.setTempoType(Function::Beats); const auto beatsOriginal = saved(probe);
        Function::setGlobalFadeOverride(1000, 250);
        probe.write(timer, universes); fader = active(probe.id()); QVERIFY(!fader.isNull());
        QCOMPARE(fader->channels().begin()->fadeTime(), uint(1000));
        probe.postRun(timer, universes);
        QCOMPARE(fader->channels().begin()->fadeTime(), uint(250));
        QCOMPARE(saved(probe), beatsOriginal); clean(probe.id());
        // RGB Matrix uses independent fade values for rising and falling pixels,
        // and the same millisecond override when the Function ends.
        RGBMatrix matrix(doc); matrix.setID(9997); matrix.setFadeInSpeed(200); matrix.setFadeOutSpeed(300);
        matrix.setTempoType(Function::Beats); const auto matrixOriginal = saved(matrix);
        FadeChannel channel(doc, 5, 2);
        matrix.updateFaderValues(channel, 255, 200);
        QCOMPARE(channel.fadeTime(), uint(1000)); channel.nextStep(500);
        matrix.updateFaderValues(channel, 0, 200);
        QCOMPARE(channel.fadeTime(), uint(250));
        fader = matrix.getFader(universe); fader->add(channel);
        matrix.postRun(timer, universes);
        QCOMPARE(fader->channels().begin()->fadeTime(), uint(250));
        QCOMPARE(saved(matrix), matrixOriginal); clean(matrix.id());
        Function::setGlobalFadeOverride(-1, -1);
    }
    void verifyBrightness(App &app)
    {
        auto *doc=app.doc(); auto *timer=doc->masterTimer(); timer->stop();
        auto *u=doc->inputOutputMap()->universe(0); const int address=doc->fixture(5)->address();
        Scene scene(doc); scene.setID(9994);
        scene.setValue(SceneValue(5,0,128)); scene.setValue(SceneValue(5,1,32)); scene.setValue(SceneValue(5,2,64));
        Function::setGlobalFadeOverride(1000,1000);
        scene.flash(timer,false,false);scene.writeDMX(timer,{u});
        QSharedPointer<GenericFader> f;
        for(const auto &candidate:u->faders()) if(candidate->parentFunctionID()==scene.id()&&!candidate->deleteRequested()) f=candidate;
        QVERIFY(!f.isNull());
        auto tick=[&](int ms) {u->zeroIntensityChannels(); f->write(u,ms);return QVector<int>{u->preGMValue(address),u->preGMValue(address+1),u->preGMValue(address+2)};};
        GenericFader::setBrightnessOverride(-1);QCOMPARE(tick(500),QVector<int>({64,16,32}));
        GenericFader::setBrightnessOverride(100);QCOMPARE(tick(0),QVector<int>({128,32,64}));
        GenericFader::setBrightnessOverride(50);QCOMPARE(tick(0),QVector<int>({64,16,32}));
        GenericFader::setBrightnessOverride(0);QCOMPARE(tick(0),QVector<int>({0,0,0}));
        GenericFader::setBrightnessOverride(100);GenericFader::setSceneColorOverride(0x00ff00);
        QCOMPARE(tick(0),QVector<int>({0,128,0}));
        GenericFader::setSceneColorOverride(-1);
        scene.unFlash(timer);scene.writeDMX(timer,{u});
        QCOMPARE(tick(0),QVector<int>({128,32,64})); // No jump when releasing a half-faded Scene.
        QCOMPARE(tick(500),QVector<int>({64,16,32}));
        QCOMPARE(tick(500),QVector<int>({0,0,0}));
        u->dismissFader(f);u->reset();GenericFader::setBrightnessOverride(-1);Function::setGlobalFadeOverride(-1,-1);
    }
    void verifyRGBBrightness(App &app)
    {
        auto *doc=app.doc(); auto *timer=doc->masterTimer(); timer->stop();
        auto *u=doc->inputOutputMap()->universe(0);
        const int rgb=doc->fixture(5)->address(), dimmer=doc->fixture(0)->address();
        Scene scene(doc); scene.setID(9993);
        scene.setValue(SceneValue(5,0,128)); scene.setValue(SceneValue(5,1,32)); scene.setValue(SceneValue(5,2,64));
        scene.setValue(SceneValue(0,0,80));
        QByteArray original; QXmlStreamWriter originalWriter(&original); scene.saveXML(&originalWriter);
        GenericFader::setBrightnessOverride(-1); GenericFader::setRGBBrightnessOverride(-1);
        Function::setGlobalFadeOverride(1000,1000);
        scene.flash(timer,false,false);scene.writeDMX(timer,{u});
        QSharedPointer<GenericFader> f;
        for(const auto &candidate:u->faders()) if(candidate->parentFunctionID()==scene.id()&&!candidate->deleteRequested()) f=candidate;
        QVERIFY(!f.isNull());
        auto tick=[&](int ms) {u->zeroIntensityChannels();f->write(u,ms);return QVector<int>{u->preGMValue(rgb),u->preGMValue(rgb+1),u->preGMValue(rgb+2),u->preGMValue(dimmer)};};
        QCOMPARE(tick(500),QVector<int>({64,16,32,40}));
        GenericFader::setRGBBrightnessOverride(100);QCOMPARE(tick(0),QVector<int>({128,32,64,40}));
        GenericFader::setRGBBrightnessOverride(0);QCOMPARE(tick(0),QVector<int>({0,0,0,40}));
        GenericFader::setRGBBrightnessOverride(50);QCOMPARE(tick(0),QVector<int>({64,16,32,40}));
        GenericFader::setBrightnessOverride(25);GenericFader::setRGBBrightnessOverride(100);
        QCOMPARE(tick(0),QVector<int>({128,32,64,32}));
        GenericFader::setBrightnessOverride(0);QCOMPARE(tick(0),QVector<int>({128,32,64,0}));
        GenericFader::setRGBBrightnessOverride(-1);QCOMPARE(tick(0),QVector<int>({0,0,0,0}));
        GenericFader::setBrightnessOverride(100);GenericFader::setRGBBrightnessOverride(25);
        QCOMPARE(tick(0),QVector<int>({32,8,16,128}));
        GenericFader::setBrightnessOverride(-1);GenericFader::setRGBBrightnessOverride(100);
        GenericFader::setSceneColorOverride(0x00ff00);QCOMPARE(tick(0),QVector<int>({0,128,0,40}));
        GenericFader::setSceneColorOverride(-1);
        scene.unFlash(timer);scene.writeDMX(timer,{u});
        QCOMPARE(tick(0),QVector<int>({128,32,64,40}));
        QCOMPARE(tick(500),QVector<int>({64,16,32,20}));
        QCOMPARE(tick(500),QVector<int>({0,0,0,0}));
        QByteArray after; QXmlStreamWriter afterWriter(&after);scene.saveXML(&afterWriter);QCOMPARE(after,original);
        u->dismissFader(f);u->reset();GenericFader::setRGBBrightnessOverride(-1);Function::setGlobalFadeOverride(-1,-1);
    }
    void verifyActualSceneColor(App &app)
    {
        auto *doc = app.doc();
        auto *timer = doc->masterTimer(); timer->stop();
        auto *universe = doc->inputOutputMap()->universe(0);
        const int address = doc->fixture(5)->address();
        Scene scene(doc); scene.setID(9995); scene.setValue(SceneValue(5,0,255));
        Function::setGlobalFadeOverride(0,0);
        auto pixel = [&]() { return QVector<int>{universe->preGMValue(address),universe->preGMValue(address+1),universe->preGMValue(address+2)}; };
        auto fader = [&]() {
            for (const auto &f : universe->faders()) if (f->parentFunctionID()==scene.id() && !f->deleteRequested()) return f;
            return QSharedPointer<GenericFader>();
        };
        // Actual Flash creation path with a sparse single-red-channel Scene.
        scene.flash(timer,false,false);scene.writeDMX(timer,{universe});auto active=fader();QVERIFY(!active.isNull());
        for (int color : {-1,0x00ff00,0x0000ff,-1}) {
            GenericFader::setSceneColorOverride(color);universe->zeroIntensityChannels();active->write(universe,20);
            QCOMPARE(pixel(), color<0 ? QVector<int>({255,0,0}) : QVector<int>({qRed(color),qGreen(color),qBlue(color)}));
        }
        scene.unFlash(timer);scene.writeDMX(timer,{universe});universe->dismissFader(active);universe->reset();
        // The non-Flash path uses the same override and restores native red.
        scene.write(timer,{universe});active=fader();QVERIFY(!active.isNull());
        GenericFader::setSceneColorOverride(0x00ff00);universe->zeroIntensityChannels();active->write(universe,20);
        QCOMPARE(pixel(),QVector<int>({0,255,0}));
        GenericFader::setSceneColorOverride(-1);universe->zeroIntensityChannels();active->write(universe,20);
        QCOMPARE(pixel(),QVector<int>({255,0,0}));
        scene.postRun(timer,{universe});universe->dismissFader(active);universe->reset();
        Function::setGlobalFadeOverride(-1,-1);
    }
    void verifyMatrixColor(App &app)
    {
        auto *doc = app.doc();
        auto *universe = doc->inputOutputMap()->universe(0);
        const int address = doc->fixture(5)->address();
        const int idleAddress = doc->fixture(6)->address();
        FixtureGroup group(doc);
        QVERIFY(group.assignFixture(5, QLCPoint(0, 0)));
        QVERIFY(group.assignFixture(6, QLCPoint(1, 0)));
        RGBMatrix matrix(doc); matrix.setID(9996);
        matrix.setBlendMode(Universe::AdditiveBlend);
        matrix.setFadeInSpeed(1000); matrix.setFadeOutSpeed(500);
        matrix.adjustAttribute(0.5, Function::Intensity);
        QByteArray original; QXmlStreamWriter writer(&original); matrix.saveXML(&writer);
        Function::setGlobalFadeOverride(-1, -1);
        matrix.updateMapChannels(RGBMap{{qRgb(0, 0, 154), qRgb(0, 0, 0)}}, &group, {universe});
        auto fader = matrix.getFader(universe);
        QVERIFY(!fader.isNull());
        GenericFader reference; reference.setBlendMode(Universe::AdditiveBlend);
        reference.adjustIntensity(0.5);
        for (int channel = 0; channel < 3; ++channel) {
            FadeChannel fc(doc, 5, channel);
            fc.setStart(0); fc.setTarget(channel == 2 ? 154 : 0);
            fc.setCurrent(0); fc.setFadeTime(1000); reference.add(fc);
        }
        auto tick = [&](int ms, int color) {
            GenericFader::setSceneColorOverride(-1);
            universe->zeroIntensityChannels(); reference.write(universe, ms);
            const int level = universe->preGMValue(address + 2);
            GenericFader::setSceneColorOverride(color);
            universe->zeroIntensityChannels(); fader->write(universe, ms);
            const QVector<int> actual{universe->preGMValue(address), universe->preGMValue(address+1), universe->preGMValue(address+2)};
            const QVector<int> expected = color < 0 ? QVector<int>{0,0,level} :
                QVector<int>{qRound(level*qRed(color)/255.0),qRound(level*qGreen(color)/255.0),qRound(level*qBlue(color)/255.0)};
            QCOMPARE(actual, expected);
            for (int channel = 0; channel < 3; ++channel)
                QCOMPARE(universe->preGMValue(idleAddress+channel), uchar(0));
        };
        // Recolour actual Matrix pixels after native fading and intensity;
        // an Off transition restores the underlying colour without restarting.
        for (int i = 0; i < 12; ++i) tick(50, 0x00ff00);
        for (int i = 0; i < 4; ++i) tick(50, 0xff33ff);
        tick(50, -1);
        // Absolute brightness raises a dim Matrix pixel while leaving idle pixels dark.
        GenericFader::setSceneColorOverride(-1); GenericFader::setBrightnessOverride(100);
        universe->zeroIntensityChannels(); fader->write(universe,200);
        QCOMPARE(universe->preGMValue(address+2),uchar(128));
        QCOMPARE(universe->preGMValue(idleAddress+2),uchar(0));
        GenericFader::setBrightnessOverride(0); universe->zeroIntensityChannels(); fader->write(universe,0);
        QCOMPARE(universe->preGMValue(address+2),uchar(0));
        GenericFader::setBrightnessOverride(-1);
        GenericFader::setRGBBrightnessOverride(100);universe->zeroIntensityChannels();fader->write(universe,0);
        QCOMPARE(universe->preGMValue(address+2),uchar(128));
        QCOMPARE(universe->preGMValue(idleAddress+2),uchar(0));
        GenericFader::setRGBBrightnessOverride(0);universe->zeroIntensityChannels();fader->write(universe,0);
        QCOMPARE(universe->preGMValue(address+2),uchar(0));
        GenericFader::setRGBBrightnessOverride(-1);
        reference.write(universe,200);
        // Owner/panic reset does not alter native targets or fade envelopes.
        matrix.postRun(doc->masterTimer(), {universe}); reference.setFadeOut(true,500);
        for (int i = 0; i < 12; ++i) tick(50, 0x00ff00);
        QCOMPARE(universe->preGMValue(address+1), uchar(0));
        QByteArray after; QXmlStreamWriter afterWriter(&after); matrix.saveXML(&afterWriter);
        QCOMPARE(after, original);
        GenericFader::setSceneColorOverride(-1);
        universe->dismissFader(fader); universe->reset();
    }
    void verifySceneColor(App &app)
    {
        auto *doc = app.doc();

        auto *scene = qobject_cast<Scene *>(doc->function(190));
        QVERIFY(scene);
        QByteArray original;
        QXmlStreamWriter originalWriter(&original); scene->saveXML(&originalWriter);
        auto *universe = doc->inputOutputMap()->universe(0);
        QVERIFY(universe);
        const int address = doc->fixture(5)->address();
        auto addRGB = [&](GenericFader &fader, bool flash, int fade) {
            for (int channel = 0; channel < 3; ++channel) {
                FadeChannel fc(doc, 5, channel);
                fc.setStart(0); fc.setTarget(channel == 2 ? 154 : 0); fc.setCurrent(0); fc.setFadeTime(fade);
                if (flash) fc.addFlag(FadeChannel::Flashing);
                fader.add(fc);
            }
        };
        auto pixel = [&]() { return QVector<int>{universe->preGMValue(address), universe->preGMValue(address+1), universe->preGMValue(address+2)}; };
        GenericFader sceneFader;
        sceneFader.setColorSource(doc); addRGB(sceneFader, true, 0);
        GenericFader::setSceneColorOverride(-1);
        universe->zeroIntensityChannels(); sceneFader.write(universe, 20);
        QCOMPARE(pixel(), QVector<int>({0,0,154}));
        GenericFader::setSceneColorOverride(0xff33ff);
        universe->zeroIntensityChannels(); sceneFader.write(universe, 20);
        QCOMPARE(pixel(), QVector<int>({154,31,154}));
        // Another fixture that this Scene never touches remains dark.
        QCOMPARE(universe->preGMValue(doc->fixture(6)->address()), uchar(0));
        GenericFader::setSceneColorOverride(-1);
        universe->zeroIntensityChannels(); sceneFader.write(universe, 20);
        QCOMPARE(pixel(), QVector<int>({0,0,154}));
        // Simple Desk / unrelated faders stay outside the color override.
        GenericFader matrixFader; addRGB(matrixFader, false, 0);
        GenericFader::setSceneColorOverride(0xff33ff);
        universe->zeroIntensityChannels(); matrixFader.write(universe, 20);
        QCOMPARE(pixel(), QVector<int>({0,0,154}));
        // Recolour the exact same native fade rather than resetting its target.
        GenericFader fadeFader; fadeFader.setColorSource(doc); addRGB(fadeFader, false, 1000);
        GenericFader referenceFader; addRGB(referenceFader, false, 1000);
        for (int step = 0; step < 20; ++step) {
            GenericFader::setSceneColorOverride(-1);
            universe->zeroIntensityChannels(); referenceFader.write(universe, 20);
            const int level = universe->preGMValue(address+2);
            GenericFader::setSceneColorOverride(0xff33ff);
            universe->zeroIntensityChannels(); fadeFader.write(universe, 20);
            QCOMPARE(pixel(), QVector<int>({level,qRound(level*51.0/255),level}));
        }
        fadeFader.setFadeOut(true, 500);
        referenceFader.setFadeOut(true, 500);
        for (int step = 0; step < 30; ++step) {
            GenericFader::setSceneColorOverride(-1);
            universe->zeroIntensityChannels(); referenceFader.write(universe, 20);
            const int level = universe->preGMValue(address+2);
            GenericFader::setSceneColorOverride(0xff33ff);
            universe->zeroIntensityChannels(); fadeFader.write(universe, 20);
            QCOMPARE(pixel(), QVector<int>({level,qRound(level*51.0/255),level}));
        }
        QCOMPARE(pixel(), QVector<int>({0,0,0}));
        QByteArray saved;
        QXmlStreamWriter savedWriter(&saved); scene->saveXML(&savedWriter);
        QCOMPARE(saved, original);
        GenericFader::setSceneColorOverride(-1);
    }
private slots:
    void renameRetargetUndoAndReload()
    {
        App app;
        app.set3dSupported(false);
        app.startup();
        app.hide();
        QVERIFY(app.loadWorkspace(qEnvironmentVariable("QLC_NAME_SYNC_FIXTURE")));
        verifyFadeOverrides(app);
        verifySceneColor(app);
        verifyBrightness(app);
        verifyRGBBrightness(app);
        verifyActualSceneColor(app);
        verifyMatrixColor(app);
        verifyFadeWebAPI(app);
        auto *doc = app.doc();
        auto *vc = app.virtualConsole();
        auto *mgr = qobject_cast<FunctionManager *>(app.rootContext()->contextProperty("functionManager").value<QObject *>());
        QVERIFY(mgr);
        auto *first = qobject_cast<VCButton *>(vc->widget(16));
        auto *second = qobject_cast<VCButton *>(vc->widget(120));
        auto *matrix = qobject_cast<VCButton *>(vc->widget(19));
        QVERIFY(first && second && matrix);
        const quint32 sceneID = first->functionID();
        auto *scene = doc->function(sceneID);
        auto *effect = doc->function(matrix->functionID());
        QVERIFY(scene && effect);
        QCOMPARE(second->functionID(), sceneID);
        // Existing saved captions must synchronize without a dummy rename.
        QCOMPARE(first->caption(), scene->name());
        QCOMPARE(second->caption(), scene->name());
        QCOMPARE(matrix->caption(), effect->name());
        second->setCaption(QStringLiteral("Custom caption before rename"));
        const QString originalName = scene->name();
        const QString firstCaption = first->caption();
        const QString secondCaption = second->caption();
        QSignalSpy firstChanges(first, &VCWidget::captionChanged);
        QSignalSpy secondChanges(second, &VCWidget::captionChanged);
        // Let the history worker drain without pumping the hidden QML view.
        // Visual rendering is exercised separately in the native UI test.
        QThread::msleep(300);
        Tardis::instance()->resetHistory();
        mgr->selectFunctionID(sceneID, false);
        QVERIFY(mgr->renameSelectedItems(QStringLiteral("Renamed scene test"), false, 1, 3));
        QCOMPARE(first->caption(), scene->name());
        QCOMPARE(second->caption(), scene->name());
        QCOMPARE(firstChanges.count(), 1);
        QCOMPARE(secondChanges.count(), 1);
        QVERIFY(doc->isModified());
        QThread::msleep(300);
        Tardis::instance()->undoAction();
        QCOMPARE(scene->name(), originalName);
        QCOMPARE(first->caption(), firstCaption);
        QCOMPARE(second->caption(), secondCaption);
        Tardis::instance()->redoAction();
        QCOMPARE(scene->name(), QStringLiteral("Renamed scene test"));
        QCOMPARE(first->caption(), scene->name());
        QCOMPARE(second->caption(), scene->name());

        // Assignment synchronizes immediately; undo restores the custom caption.
        second->setCaption(QStringLiteral("Custom caption before reassignment"));
        QThread::msleep(300);
        Tardis::instance()->resetHistory();
        second->setFunctionID(effect->id());
        QCOMPARE(second->caption(), effect->name());
        QThread::msleep(300);
        Tardis::instance()->undoAction();
        QCOMPARE(second->functionID(), sceneID);
        QCOMPARE(second->caption(), QStringLiteral("Custom caption before reassignment"));
        Tardis::instance()->redoAction();
        QCOMPARE(second->functionID(), effect->id());
        QCOMPARE(second->caption(), effect->name());
        // Reassign twice: no stale subscription and no duplicate notification.
        second->setFunctionID(effect->id());
        const QString beforeOldRename = second->caption();
        scene->setName(QStringLiteral("Second scene name"));
        QCOMPARE(first->caption(), scene->name());
        QCOMPARE(second->caption(), beforeOldRename);
        QSignalSpy matrixChanges(matrix, &VCWidget::captionChanged);
        secondChanges.clear();
        effect->setName(QString::fromUtf8("004-Rename \xe8\xb5\xa4 test"));
        QCOMPARE(matrix->caption(), effect->name());
        QCOMPARE(second->caption(), effect->name());
        QCOMPARE(matrixChanges.count(), 1);
        QCOMPARE(secondChanges.count(), 1);
        matrix->setCaption(QStringLiteral("Custom button name"));
        QCOMPARE(effect->name(), QString::fromUtf8("004-Rename \xe8\xb5\xa4 test"));
        second->setCaption(QStringLiteral("Custom caption before detachment"));
        QThread::msleep(300);
        Tardis::instance()->resetHistory();
        second->setFunctionID(Function::invalidId());
        QCOMPARE(second->caption(), second->defaultCaption());
        QThread::msleep(300);
        Tardis::instance()->undoAction();
        QCOMPARE(second->functionID(), effect->id());
        QCOMPARE(second->caption(), QStringLiteral("Custom caption before detachment"));
        Tardis::instance()->redoAction();
        QCOMPARE(second->functionID(), Function::invalidId());
        QCOMPARE(second->caption(), second->defaultCaption());
        const QString detachedCaption = second->caption();
        effect->setName(QStringLiteral("Matrix final name"));
        QCOMPARE(matrix->caption(), effect->name());
        QCOMPARE(second->caption(), detachedCaption);

        QTemporaryDir tmp;
        QVERIFY(tmp.isValid());
        const QString saved = tmp.filePath("renamed.qxw");
        matrix->setCaption(QStringLiteral("Outdated caption saved before reload"));
        second->setCaption(QStringLiteral("Stale detached caption"));
        QVERIFY(app.saveWorkspace(saved));
        QFile savedFile(saved);
        QVERIFY(savedFile.open(QIODevice::ReadOnly));
        QVERIFY(savedFile.readAll().contains("Outdated caption saved before reload"));
        savedFile.close();
        QVERIFY(app.loadWorkspace(saved));
        first = qobject_cast<VCButton *>(vc->widget(16));
        matrix = qobject_cast<VCButton *>(vc->widget(19));
        second = qobject_cast<VCButton *>(vc->widget(120));
        QVERIFY(first && matrix && second);
        QCOMPARE(second->caption(), second->defaultCaption());
        QCOMPARE(first->caption(), QStringLiteral("Second scene name"));
        QCOMPARE(matrix->caption(), QStringLiteral("Matrix final name"));
        doc->function(first->functionID())->setName(QStringLiteral("After reload"));
        QCOMPARE(first->caption(), QStringLiteral("After reload"));
        mgr->setEditorFunction(first->functionID(), false, false);
        auto *editor = mgr->currentEditor();
        QVERIFY(editor);
        editor->setFunctionName(QStringLiteral("Renamed in scene editor"));
        QCOMPARE(first->caption(), QStringLiteral("Renamed in scene editor"));
        app.stopAllFunctions();
    }
};

int main(int argc, char **argv)
{
    QApplication app(argc, argv);
    QCoreApplication::setOrganizationName("qlcplus-name-sync-test");
    QCoreApplication::setApplicationName("isolated-regression");
    QQuickWindow::setGraphicsApi(QSGRendererInterface::OpenGLRhi);
    NameSyncTest test;
    return QTest::qExec(&test, argc, argv);
}
#include "name-sync-test.moc"
