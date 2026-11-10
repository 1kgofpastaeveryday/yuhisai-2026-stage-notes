#include <QApplication>
#include <QFile>
#include <QSettings>
#include <QQmlContext>
#include <QSignalSpy>
#include <QTemporaryDir>
#include <QtTest>
#include "app.h"
#include "doc.h"
#include "functionmanager.h"
#include "functioneditor.h"
#include "tardis.h"
#include "virtualconsole.h"
#include "vcbutton.h"
#include "sceneeditor.h"
#include "scene.h"
#include "fixture.h"
#include "listmodel.h"
#include <QDir>

class TestConsole : public QQuickItem
{
    Q_OBJECT
public:
    int updates = 0;
    Q_INVOKABLE void setChannelValue(QVariant, QVariant) { ++updates; }
};

class NameSyncTest : public QObject
{
    Q_OBJECT
private slots:
    void renameRetargetUndoAndReload()
    {
        App app;
        app.set3dSupported(false);
        app.startup();
        if (qEnvironmentVariableIsSet("QLC_SCENE_UI_TEST")) app.show(); else app.hide();
        QVERIFY(app.loadWorkspace(qEnvironmentVariable("QLC_NAME_SYNC_FIXTURE")));
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
        // Reproduce a delegate disappearing before its delayed destruction
        // callback, then verify a replacement at the same index survives it.
        auto *sceneEditor = qobject_cast<SceneEditor *>(mgr->currentEditor());
        QVERIFY(sceneEditor);
        QQuickItem consoleRoot(app.rootObject());
        consoleRoot.setObjectName("sceneFixtureConsole");
        sceneEditor->sceneConsoleLoaded(true, &consoleRoot);
        auto *model = sceneEditor->fixtureList().value<ListModel *>();
        QVERIFY(model && model->rowCount() > 0);
        auto *fixture = model->itemAt(0).toMap().value("cRef").value<Fixture *>();
        QVERIFY(fixture);
        auto *editableScene = qobject_cast<Scene *>(doc->function(first->functionID()));
        QVERIFY(editableScene);
        auto *retired = new TestConsole;
        sceneEditor->registerFixtureConsole(0, retired);
        delete retired;
        editableScene->setValue(fixture->id(), 0, 100);
        TestConsole oldConsole, replacement;
        sceneEditor->registerFixtureConsole(0, &oldConsole);
        sceneEditor->registerFixtureConsole(0, &replacement);
        sceneEditor->unRegisterFixtureConsole(0, &oldConsole);
        editableScene->setValue(fixture->id(), 0, 101);
        QCOMPARE(replacement.updates, 1);
        sceneEditor->addComponent(App::FixtureDragItem, fixture->id());
        editableScene->setValue(fixture->id(), 0, 102);
        QCOMPARE(replacement.updates, 1); // old row identity was invalidated
        sceneEditor->sceneConsoleLoaded(false, &consoleRoot);
        mgr->setEditorFunction(Function::invalidId(), false, false);
        QVERIFY(!mgr->currentEditor());

        // A real save, a timed-save callback, and the exact prior revision.
        QVERIFY(app.saveWorkspace(saved));
        QFile prior(saved);
        QVERIFY(prior.open(QIODevice::ReadOnly));
        const QByteArray priorBytes = prior.readAll();
        prior.close();
        first->setCaption("Automatically saved revision");
        QVERIFY(doc->isModified());
        QVERIFY(QMetaObject::invokeMethod(&app, "slotDocAutosave"));
        QVERIFY(!doc->isModified());
        QFile automatic(saved);
        QVERIFY(automatic.open(QIODevice::ReadOnly));
        QVERIFY(automatic.readAll().contains("Automatically saved revision"));
        automatic.close();
        QDir backups(saved + ".backups");
        auto entries = backups.entryList({"*.qxw"}, QDir::Files, QDir::Name);
        QVERIFY(!entries.isEmpty());
        QFile backup(backups.filePath(entries.last()));
        QVERIFY(backup.open(QIODevice::ReadOnly));
        QCOMPARE(backup.readAll(), priorBytes);
        backup.close();
        for (int i = 0; i < 32; ++i)
        {
            first->setCaption(QString("Revision %1").arg(i));
            QVERIFY(QMetaObject::invokeMethod(&app, "slotDocAutosave"));
        }
        QCOMPARE(backups.entryList({"*.qxw"}, QDir::Files).size(), 30);
        // A failed backup must leave the workspace and modified state intact.
        const QString blocked = tmp.filePath("blocked.qxw");
        QVERIFY(app.saveWorkspace(blocked));
        QFile blocker(blocked + ".backups");
        QVERIFY(blocker.open(QIODevice::WriteOnly));
        blocker.write("not a directory");
        blocker.close();
        first->setCaption("Must remain unsaved");
        QVERIFY(QMetaObject::invokeMethod(&app, "slotDocAutosave"));
        QVERIFY(doc->isModified());
        QFile unchanged(blocked);
        QVERIFY(unchanged.open(QIODevice::ReadOnly));
        QVERIFY(!unchanged.readAll().contains("Must remain unsaved"));
        if (qEnvironmentVariableIsSet("QLC_SCENE_UI_TEST"))
        {
            // Exercise the actual Scene and fixture-console QML lifetimes.
            consoleRoot.setObjectName("");
            QVERIFY(QMetaObject::invokeMethod(app.rootObject(), "switchToContext",
                    Q_ARG(QVariant, "FIXANDFUNC"),
                    Q_ARG(QVariant, "qrc:/FixturesAndFunctions.qml")));
            QTest::qWait(100);
            auto *panel = app.rootObject()->findChild<QQuickItem *>("funcRightPanel");
            QVERIFY(panel);
            for (int i = 0; i < 100; ++i)
            {
                mgr->setEditorFunction(first->functionID(), true, false);
                QTest::qWait(10);
                auto *current = qobject_cast<SceneEditor *>(mgr->currentEditor());
                QVERIFY(current);
                current->addComponent(App::FixtureDragItem, fixture->id());
                mgr->setChannelValue(fixture->id(), 0, uchar(i));
                QTest::qWait(10);
                QVERIFY(QMetaObject::invokeMethod(panel, "requestEditor",
                        Q_ARG(QVariant, -1), Q_ARG(QVariant, 0)));
                mgr->setEditorFunction(Function::invalidId(), false, false);
                if (i % 10 == 0)
                {
                    const quint32 transient = mgr->createFunction(Function::SceneType, {});
                    QVERIFY(doc->function(transient));
                    mgr->setEditorFunction(transient, true, false);
                    QTest::qWait(10);
                    mgr->deleteFunction(transient);
                    QVERIFY(!doc->function(transient));
                }
                app.engine()->collectGarbage();
                QCoreApplication::sendPostedEvents(nullptr, QEvent::DeferredDelete);
                QTest::qWait(10);
            }
            // Return to a writable file. Continuous edits must not postpone
            // the real 30-second periodic save indefinitely.
            const QString timed = tmp.filePath("continuous.qxw");
            QVERIFY(app.saveWorkspace(timed));
            QTimer edits;
            edits.setInterval(25);
            int editCount = 0;
            connect(&edits, &QTimer::timeout, &app, [&] {
                first->setCaption(QString("Continuous revision %1").arg(++editCount));
            });
            edits.start();
            QTest::qWait(31000);
            edits.stop();
            QFile periodic(timed);
            QVERIFY(periodic.open(QIODevice::ReadOnly));
            QVERIFY(periodic.readAll().contains("Continuous revision"));
            QVERIFY(QDir(timed + ".backups").entryList({"*.qxw"}, QDir::Files).size() > 0);
            qInfo() << "Scene QML open/add/value/close/GC cycles: 100; continuous-edit periodic save passed";
        }
        app.stopAllFunctions();
    }
};

int main(int argc, char **argv)
{
    QApplication app(argc, argv);
    QCoreApplication::setOrganizationName("qlcplus-name-sync-test");
    QCoreApplication::setApplicationName("isolated-regression");
    QQuickWindow::setGraphicsApi(QSGRendererInterface::OpenGLRhi);
    QTemporaryDir isolatedSettings;
    QSettings::setDefaultFormat(QSettings::IniFormat);
    QSettings::setPath(QSettings::IniFormat, QSettings::UserScope, isolatedSettings.path());
    NameSyncTest test;
    return QTest::qExec(&test, argc, argv);
}
#include "save-regression.moc"
