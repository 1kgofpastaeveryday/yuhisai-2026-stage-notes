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

class NameSyncTest : public QObject
{
    Q_OBJECT
private slots:
    void renameRetargetUndoAndReload()
    {
        App app;
        app.set3dSupported(false);
        app.startup();
        app.hide();
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
