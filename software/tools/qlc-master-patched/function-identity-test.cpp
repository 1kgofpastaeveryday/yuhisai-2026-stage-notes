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
class IdentityTest : public QObject {
    Q_OBJECT
private slots:
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
        qInfo() << "After same-name rename: first refs" << references(tree).count(first)
                << "renamed second refs" << references(tree).count(second);
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
            qInfo() << "Native cycle" << i << "after rename: first refs"
                    << references(tree).count(first) << "second refs" << references(tree).count(second);
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
        qInfo() << "After deleting second: first refs" << references(tree).count(first)
                << "deleted second refs" << references(tree).count(second)
                << "second absent from Doc" << (app.doc()->function(secondID) == nullptr);
        QCOMPARE(references(tree).count(first), 1); QCOMPARE(references(tree).count(second), 0);
        app.stopAllFunctions();
    }
};
int main(int argc, char **argv) {
    QApplication app(argc, argv); QCoreApplication::setOrganizationName("qlcplus-identity-tests");
    QCoreApplication::setApplicationName("isolated"); QTemporaryDir settings;
    QSettings::setDefaultFormat(QSettings::IniFormat); QSettings::setPath(QSettings::IniFormat,QSettings::UserScope,settings.path());
    IdentityTest test; return QTest::qExec(&test,argc,argv);
}
#include "function-identity-test.moc"
