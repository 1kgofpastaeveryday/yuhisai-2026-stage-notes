#include <QApplication>
#include <QSettings>
#include <QTemporaryDir>
#include <QTimer>
#include <QDebug>
#include "app.h"
#include "doc.h"
#include "webaccess-qml.h"

int main(int argc, char **argv)
{
    QApplication application(argc, argv);
    if (argc != 4)
        return 2;
    QCoreApplication::setOrganizationName("qlcplus-master-candidate-tests");
    QCoreApplication::setApplicationName("isolated-webbridge");
    QTemporaryDir settings;
    QSettings::setDefaultFormat(QSettings::IniFormat);
    QSettings::setPath(QSettings::IniFormat, QSettings::UserScope, settings.path());
    App app;
    app.set3dSupported(false);
    app.startup();
    if (!app.loadWorkspace(QString::fromLocal8Bit(argv[1])))
        return 3;
    app.show();
    WebAccessQml web(app.doc(), app.virtualConsole(), app.simpleDesk(),
                     QString::fromLocal8Bit(argv[2]).toInt(), false);
    QTimer::singleShot(QString::fromLocal8Bit(argv[3]).toInt(), &application,
                       &QCoreApplication::quit);
    qInfo() << "Isolated WebBridge host ready";
    const int result = application.exec();
    app.stopAllFunctions();
    return result;
}
