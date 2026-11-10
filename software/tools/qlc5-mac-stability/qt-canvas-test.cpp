#include <QGuiApplication>
#include <QQmlEngine>
#include <QQmlComponent>
#include <QQmlContext>
#include <QQuickItem>
#include <QQuickWindow>
#include <QDebug>
#include <QPointer>
#include <QElapsedTimer>
int main(int argc,char **argv) {
    QGuiApplication app(argc,argv);
    QQuickWindow::setGraphicsApi(QSGRendererInterface::OpenGLRhi);
    for(int i=0;i<100;++i) {
        QQmlEngine engine;
        QQmlComponent component(&engine);
        component.setData("import QtQuick; Canvas { width:100; height:100; contextType: '2d' }",QUrl());
        if(!component.isReady()) {qCritical()<<component.errors();return 2;}
        auto *context=new QQmlContext(engine.rootContext());
        auto *canvas=qobject_cast<QQuickItem *>(component.create(context));
        if(!canvas)return 3;
        QQuickWindow window; canvas->setParentItem(window.contentItem()); window.show();
        QPointer<QQuickItem> guarded=canvas;
        QQmlEngine::setObjectOwnership(canvas,QQmlEngine::JavaScriptOwnership);
        delete context;
        engine.collectGarbage();
        if(qmlEngine(canvas)) {qCritical()<<"Test did not invalidate Canvas QML engine";return 6;}
        QElapsedTimer elapsed;elapsed.start();
        while(elapsed.elapsed()<100) QCoreApplication::processEvents();
        if(guarded) delete guarded.data();
        QCoreApplication::sendPostedEvents(nullptr,QEvent::DeferredDelete);
    }
    qInfo()<<"PASS 100 Canvas initializations after QML context teardown";
}
