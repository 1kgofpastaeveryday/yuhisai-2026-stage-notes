#include <QApplication>
#include <QSettings>
#include <QTemporaryDir>
#include <QQmlContext>
#include <QtTest>
#include "app.h"
#include "doc.h"
#include "functionmanager.h"
#include "functioneditor.h"
#include "scene.h"
#include "sceneeditor.h"
#include "listmodel.h"
#include "fixture.h"
#include "mastertimer.h"
#include <QFile>
#include <QDir>
#include "treemodel.h"
#include "treemodelitem.h"

static QList<Function *> references(TreeModel *tree) {
    QList<Function *> result;
    for (auto *item : tree->items()) {
        if (auto *f = item->data(0).value<Function *>()) result.append(f);
        if (item->hasChildren()) result.append(references(item->children()));
    }
    return result;
}
class TestConsole : public QQuickItem {
    Q_OBJECT
public:
    int updates = 0;
    Q_INVOKABLE void setChannelValue(QVariant, QVariant) { ++updates; }
};
class IdentityTest : public QObject {
    Q_OBJECT
private slots:
    void copiedShowPlaybackAndLifetime() {
        App app; app.set3dSupported(false); app.startup(); app.show();
        QVERIFY(app.loadWorkspace(qEnvironmentVariable("QLC_TEST_SHOW")));
        auto *doc = app.doc();
        auto *mgr = app.rootContext()->contextProperty("functionManager").value<FunctionManager *>();
        QVERIFY(mgr);
        QList<Function *> cues;
        Scene *scene = nullptr;
        for (auto *f : doc->functions()) {
            if (f->type() == Function::SceneType || f->type() == Function::ChaserType || f->type() == Function::SequenceType || f->type() == Function::RGBMatrixType) cues.append(f);
            if (!scene && f->type() == Function::SceneType) scene = qobject_cast<Scene *>(f);
        }
        QVERIFY(scene); QVERIFY(cues.size() > 300);
        QTemporaryDir tmp;
        QVERIFY(app.saveWorkspace(tmp.filePath("test.qxw")));
        mgr->setEditorFunction(scene->id(), true, false);
        auto *editor = qobject_cast<SceneEditor *>(mgr->currentEditor()); QVERIFY(editor);
        auto *model = editor->fixtureList().value<ListModel *>(); QVERIFY(model && model->rowCount() > 0);
        auto *fx = model->itemAt(0).toMap().value("cRef").value<Fixture *>(); QVERIFY(fx);
        QQuickItem root(app.rootObject()); root.setObjectName("sceneFixtureConsole");
        editor->sceneConsoleLoaded(true);
        auto *retired = new TestConsole; editor->registerFixtureConsole(0, retired); delete retired;
        scene->setValue(fx->id(), 0, 100);
        TestConsole old, replacement;
        editor->registerFixtureConsole(0, &old); editor->registerFixtureConsole(0, &replacement);
        editor->unRegisterFixtureConsole(0, &old);
        scene->setValue(fx->id(), 0, 101); QCOMPARE(replacement.updates, 1);
        editor->sceneConsoleLoaded(false);
        mgr->setEditorFunction(Function::invalidId(),false,false);
        root.setObjectName("finishedTestConsole");
        for (int i=0;i<100;++i) {
            auto *f = cues.at(i % cues.size());
            f->start(doc->masterTimer(), FunctionParent::master()); QTest::qWait(40);
            f->stop(FunctionParent::master());
            mgr->setEditorFunction(scene->id(),true,false); QTest::qWait(10);
            mgr->setEditorFunction(Function::invalidId(),false,false);
            app.engine()->collectGarbage();
            QCoreApplication::sendPostedEvents(nullptr,QEvent::DeferredDelete);
        }
        for (auto *f : cues) { f->start(doc->masterTimer(),FunctionParent::master()); QTest::qWait(25); f->stop(FunctionParent::master()); }
        app.stopAllFunctions(); QTest::qWait(100);
        QVERIFY(app.saveWorkspace(tmp.filePath("saved.qxw")));
        const QString saved=tmp.filePath("saved.qxw"); QFile prior(saved); QVERIFY(prior.open(QIODevice::ReadOnly)); auto before=prior.readAll(); prior.close();
        scene->setName("Atomic save verification"); QVERIFY(QMetaObject::invokeMethod(&app,"slotDocAutosave")); QVERIFY(!doc->isModified());
        QDir backups(saved+".backups"); auto entries=backups.entryList({"*.qxw"},QDir::Files,QDir::Name); QVERIFY(!entries.isEmpty());
        QFile backup(backups.filePath(entries.last())); QVERIFY(backup.open(QIODevice::ReadOnly)); QCOMPARE(backup.readAll(),before); backup.close();
        for(int i=0;i<32;++i) {scene->setName(QString("revision %1").arg(i)); QVERIFY(app.saveWorkspace(saved));}
        QCOMPARE(backups.entryList({"*.qxw"},QDir::Files).size(),30);
        QFile original(saved); QVERIFY(original.open(QIODevice::ReadOnly)); auto originalBytes=original.readAll(); original.close();
        const QString blocked=tmp.filePath("blocked.qxw"); QVERIFY(QFile::copy(saved,blocked));
        QFile block(blocked+".backups"); QVERIFY(block.open(QIODevice::WriteOnly)); block.write("not a directory"); block.close();
        scene->setName("must not replace original when backup fails"); QVERIFY(!app.saveWorkspace(blocked));
        QFile unchanged(blocked); QVERIFY(unchanged.open(QIODevice::ReadOnly)); QCOMPARE(unchanged.readAll(),originalBytes); unchanged.close();
        QVERIFY(app.saveWorkspace(saved));
        QTimer edits; edits.setInterval(25); int editCount=0;
        connect(&edits,&QTimer::timeout,&app,[&]{scene->setName(QString("Continuous edit %1").arg(++editCount));});
        edits.start(); QTest::qWait(31000); edits.stop();
        QFile timed(saved); QVERIFY(timed.open(QIODevice::ReadOnly)); QVERIFY(timed.readAll().contains("Continuous edit")); timed.close();
        qInfo() << "31-second continuous-edit timer passed";
        qInfo() << "Copied show cues:" << cues.size() << "; 100 Scene open/close/GC cycles; guarded console and atomic save retention verified";
    }


    void loopingChaserSoak() {
        App app; app.set3dSupported(false); app.startup(); app.show();
        QVERIFY(app.loadWorkspace(qEnvironmentVariable("QLC_TEST_SHOW")));
        auto *loop = app.doc()->function(14); QVERIFY(loop); QCOMPARE(loop->type(),Function::ChaserType); QCOMPARE(loop->runOrder(),Function::Loop);
        loop->start(app.doc()->masterTimer(),FunctionParent::master());
        for(int i=0;i<120;++i) {QTest::qWait(1000); QVERIFY(loop->isRunning());}
        app.stopAllFunctions(); QTest::qWait(250); QVERIFY(!loop->isRunning());
        qInfo()<<"120-second running Chaser verified every second; stop verified";
    }
    void duplicateNamesRenameAndDelete() {
        App app; app.set3dSupported(false); app.startup(); app.hide();
        auto *manager = app.rootContext()->contextProperty("functionManager").value<FunctionManager *>();
        QVERIFY(manager);
        auto *tree = manager->functionsList().value<TreeModel *>();
        auto *first = new Scene(app.doc()); first->setName("011-blue-bottom-odds-middleonly"); first->setPath("Scenes");
        auto *second = new Scene(app.doc()); second->setName(first->name()); second->setPath("Scenes");
        QVERIFY(app.doc()->addFunction(first)); QVERIFY(app.doc()->addFunction(second));
        QCOMPARE(references(tree).count(first), 1); QCOMPARE(references(tree).count(second), 1);
        second->setName("011-blue-bottom-odds-middleonly-edited");
        QCOMPARE(references(tree).count(first), 1);
        QCOMPARE(references(tree).count(second), 1);
        auto secondID = second->id(); manager->deleteFunction(secondID);
        QVERIFY(!app.doc()->function(secondID));
        QCOMPARE(references(tree).count(first), 1); QCOMPARE(references(tree).count(second), 0);
        app.stopAllFunctions();
    }
    void nativeRepeatedDuplicateNames() {
        if (!qEnvironmentVariableIsSet("QLC_IDENTITY_NATIVE")) QSKIP("Enable QLC_IDENTITY_NATIVE for visible native test");
        App app; app.set3dSupported(false); app.startup(); app.show();
        auto *manager = app.rootContext()->contextProperty("functionManager").value<FunctionManager *>();
        QVERIFY(manager); auto *tree = manager->functionsList().value<TreeModel *>();
        auto *panel = app.rootObject()->findChild<QObject *>("funcRightPanel"); QVERIFY(panel);
        QVERIFY(QMetaObject::invokeMethod(panel, "closeEditor"));
        QVERIFY(QMetaObject::invokeMethod(panel, "animatePanel", Q_ARG(QVariant,true)));
        for (int i=0; i<50; ++i) {
            auto firstID=manager->createFunction(Function::SceneType,{});
            auto secondID=manager->createFunction(Function::SceneType,{});
            auto *first=app.doc()->function(firstID); auto *second=app.doc()->function(secondID);
            first->setName("011-blue-bottom-odds-middleonly");
            manager->setEditorFunction(secondID,true,false);
            QVERIFY(manager->currentEditor());
            manager->currentEditor()->setFunctionName(first->name());
            QVERIFY(QMetaObject::invokeMethod(panel,"closeEditor"));
            manager->setEditorFunction(Function::invalidId(),false,false);
            manager->selectFunctionID(firstID,false); manager->moveFunctions("Scenes`Nested");
            manager->selectFunctionID(secondID,false); manager->moveFunctions("Scenes`Nested");
            tree->setItemRoleData("Scenes",true,TreeModel::IsExpandedRole);
            tree->setItemRoleData("Scenes`Nested",true,TreeModel::IsExpandedRole);
            QTest::qWait(10);
            QCOMPARE(references(tree).count(first),1); QCOMPARE(references(tree).count(second),1);
            second->setName("renamed");
            QCOMPARE(references(tree).count(first),1); QCOMPARE(references(tree).count(second),1);
            second->setName(first->name());
            manager->deleteFunctions({QVariant(secondID)});
            QCOMPARE(references(tree).count(first),1); QCOMPARE(references(tree).count(second),0);
            QTest::qWait(10); app.engine()->collectGarbage();
            manager->deleteFunction(firstID); QCOMPARE(references(tree).size(),0);
            QTest::qWait(10);
        }
        app.stopAllFunctions();
    }
    void duplicateNamesDeleteSecond() {
        App app; app.set3dSupported(false); app.startup(); app.hide();
        auto *manager = app.rootContext()->contextProperty("functionManager").value<FunctionManager *>();
        QVERIFY(manager); auto *tree = manager->functionsList().value<TreeModel *>();
        auto *first = new Scene(app.doc()); first->setName("same"); first->setPath("Scenes");
        auto *second = new Scene(app.doc()); second->setName("same"); second->setPath("Scenes");
        QVERIFY(app.doc()->addFunction(first)); QVERIFY(app.doc()->addFunction(second));
        auto secondID = second->id(); manager->deleteFunction(secondID);
        QCOMPARE(references(tree).count(first), 1); QCOMPARE(references(tree).count(second), 0);
        app.stopAllFunctions();
    }
};
int main(int argc, char **argv) {
    QApplication app(argc, argv); QQuickWindow::setGraphicsApi(QSGRendererInterface::OpenGLRhi); QCoreApplication::setOrganizationName("qlcplus-identity-tests");
    QCoreApplication::setApplicationName("isolated"); QTemporaryDir settings;
    QSettings::setDefaultFormat(QSettings::IniFormat); QSettings::setPath(QSettings::IniFormat,QSettings::UserScope,settings.path());
    IdentityTest test; return QTest::qExec(&test,argc,argv);
}
#include "stability-test.moc"
