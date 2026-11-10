#include <QApplication>
#include <QSettings>
#include <QTemporaryDir>
#include <QtTest>
#include "app.h"
#include "doc.h"
#include "vcbutton.h"
#define protected public
#include "virtualconsole.h"
#undef protected

class PageRoutingTest : public QObject
{
    Q_OBJECT
private slots:
    void inactivePageInput()
    {
        App app;
        app.set3dSupported(false);
        app.startup();
        QVERIFY(app.loadWorkspace(qEnvironmentVariable("QLC_PAGE_ROUTING_FIXTURE")));
        auto *vc = app.virtualConsole();
        QCOMPARE(vc->pagesCount(), 2);
        vc->setEditMode(false);
        vc->setSelectedPage(0);
        vc->enableExternalInput(true);
        auto *second = qobject_cast<VCButton *>(vc->widget(120));
        QVERIFY(second);
        QVERIFY(vc->page(1)->children(true).contains(second));
        const bool channels = qEnvironmentVariableIsSet("QLC_PAGE_CHANNELS_TEST");
        vc->slotInputValueChanged(0, 4096 * 2 + 128 + 44, 255);
        if (channels)
            QTRY_COMPARE(second->state(), VCButton::Active);
        else
        {
            QTest::qWait(50);
            QVERIFY(second->state() != VCButton::Active);
        }
        vc->slotInputValueChanged(0, 4096 * 2 + 128 + 44, 0);
        QTRY_VERIFY(second->state() != VCButton::Active);
        app.stopAllFunctions();
    }
};

int main(int argc, char **argv)
{
    QApplication app(argc, argv);
    QCoreApplication::setOrganizationName("qlcplus-master-page-tests");
    QCoreApplication::setApplicationName("isolated");
    QTemporaryDir settings;
    QSettings::setDefaultFormat(QSettings::IniFormat);
    QSettings::setPath(QSettings::IniFormat, QSettings::UserScope, settings.path());
    PageRoutingTest test;
    return QTest::qExec(&test, argc, argv);
}
#include "page-routing-test.moc"
