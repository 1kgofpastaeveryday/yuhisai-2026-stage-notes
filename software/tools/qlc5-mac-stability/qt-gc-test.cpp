#include <QCoreApplication>
#include <QQmlEngine>
#include <QQmlComponent>
#include <QDebug>
#include <memory>
int main(int argc,char **argv) {
    QCoreApplication app(argc,argv);
    if(argc!=3) return 2;
    for(int file=1;file<3;++file) {
        for(int i=0;i<100;++i) {
            QQmlEngine engine;
            QQmlComponent component(&engine,QUrl::fromLocalFile(QString::fromLocal8Bit(argv[file])));
            if(!component.isReady()) {qCritical()<<component.errors();return 3;}
            std::unique_ptr<QObject> root(component.create());
            if(!root || !QMetaObject::invokeMethod(root.get(),"createAndForget")) return 4;
            engine.collectGarbage();
            if(!root->setProperty("flip",true)) return 5;
        }
        qInfo()<<"PASS 100 GC/rebinding cycles:"<<argv[file];
    }
    return 0;
}
